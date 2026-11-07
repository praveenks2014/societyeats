/** npm run vapid:generate — prints a VAPID key pair for web push. Put both in Replit Secrets; never commit them. */
import * as webpush from 'web-push';

const k = webpush.generateVAPIDKeys();
console.log('Add these to Replit Secrets (Tools → Secrets):\n');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:support@your-domain.example   (optional; a contact for push services)\n');
console.log('Without these, web push is simply switched off; email and in-app messages still work.');
