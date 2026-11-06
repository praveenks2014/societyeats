import { ANTI_SCAM_NOTICE, RULES_VERIFIED_NOTE } from '@/lib/fssai/assistant';

export default function FssaiHelpPage() {
  return (
    <>
      <h1>FSSAI help for home kitchens</h1>
      <p>{ANTI_SCAM_NOTICE}</p>
      <p>Our guide helps you decide which FSSAI registration or licence fits your sales, and walks you through applying yourself on the official FoSCoS portal. PadosiPlate never asks for your FoSCoS password.</p>
      <p>{RULES_VERIFIED_NOTE}</p>
    </>
  );
}
