import { api, ApiError, ok } from '@/lib/api';
import { requireSession, type Role } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { saveUpload, type UploadPurpose } from '@/lib/storage/files';

export const dynamic = 'force-dynamic';

type Policy = {
  roles: Role[];
  visibility: 'public' | 'private';
  allowed: ('image' | 'video' | 'pdf')[];
  encrypt?: boolean;
};

/**
 * Who may upload what. Buyers can only attach evidence to a complaint; every
 * other upload is a seller (kitchen) or admin action. Documents that identify
 * a person (FSSAI certificate, ID proof) are private; ID/address proofs are
 * additionally encrypted at rest.
 */
const POLICIES: Record<UploadPurpose, Policy> = {
  dish: { roles: ['seller'], visibility: 'public', allowed: ['image'] },
  kitchen: { roles: ['seller'], visibility: 'public', allowed: ['image'] },
  kitchen_video: { roles: ['seller'], visibility: 'public', allowed: ['video'] },
  fssai_doc: { roles: ['seller'], visibility: 'private', allowed: ['image', 'pdf'] },
  id_proof: { roles: ['seller'], visibility: 'private', allowed: ['image', 'pdf'], encrypt: true },
  address_proof: { roles: ['seller'], visibility: 'private', allowed: ['image', 'pdf'], encrypt: true },
  complaint: { roles: ['buyer', 'seller', 'admin'], visibility: 'private', allowed: ['image'] },
  fssai_content: { roles: ['admin'], visibility: 'public', allowed: ['image'] },
  attachment: { roles: ['seller', 'admin', 'buyer'], visibility: 'private', allowed: ['image', 'pdf'] },
};

/** Default purpose for older clients that didn't send one. */
const LEGACY_DEFAULT: UploadPurpose = 'dish';

export const POST = api(async (req) => {
  const session = await requireSession();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file');
  const purpose = ((form.get('purpose') as string) || LEGACY_DEFAULT) as UploadPurpose;
  const policy = POLICIES[purpose];
  if (!policy) throw new ApiError(400, 'Unknown upload purpose');
  if (!policy.roles.includes(session.role)) throw new ApiError(403, 'Your account type cannot upload this');
  await rateLimit(`upload:${session.uid}`, { limit: 40, windowMs: 10 * 60 * 1000 });

  // An Aadhaar image is only accepted if the browser masking tool vouches that
  // the first 8 digits were blacked out BEFORE upload (the original never leaves the device).
  if (purpose === 'id_proof' && form.get('idType') === 'aadhaar' && form.get('aadhaarMasked') !== 'true') {
    throw new ApiError(400, 'Mask the first 8 digits of your Aadhaar before uploading');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveUpload({
    ownerId: session.uid,
    purpose,
    buffer,
    visibility: policy.visibility,
    encrypt: policy.encrypt,
    allowed: policy.allowed,
    // ID proofs are deleted a fixed time after upload at the latest; verification
    // shortens it to `fssaiDocRetentionDays` (Step 8).
    deleteAfter: purpose === 'id_proof' || purpose === 'address_proof' ? new Date(Date.now() + 90 * 24 * 3600 * 1000) : null,
  });
  return ok({ url: saved.url, key: saved.key });
});
