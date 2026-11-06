/** Default texts of the 18 disclaimers (draft, pending lawyer review). Seeded once; admin edits are never overwritten. */
export const DISCLAIMER_DEFAULTS = {
  marketplace: 'PadosiPlate is an online marketplace that connects you with independent home cooks in nearby gated communities. PadosiPlate does not prepare, cook, store or deliver food. Each kitchen is solely responsible for its food, hygiene, ingredients and allergen information.',
  'home-kitchen': 'Prepared in a home kitchen, not a commercial facility. Kitchens self-declare hygiene practices; PadosiPlate verifies identity, UPI ownership and FSSAI status, but does not inspect kitchens.',
  'fssai-provisional': "This kitchen has applied for FSSAI registration and is selling within PadosiPlate's provisional limits while the application is processed.",
  allergens: 'Allergen information is declared by the kitchen. If you have a food allergy, confirm ingredients with the kitchen in chat before ordering. Cross-contamination in home kitchens cannot be ruled out.',
  'veg-mark': 'Veg / egg / non-veg marking is declared by the kitchen.',
  'consume-by': 'Best consumed within {N} hours of delivery. Refrigerate leftovers promptly.',
  pricing: 'Food price is set by the kitchen and paid directly to the kitchen at your door. The platform fee is charged by PadosiPlate now to confirm your booking.',
  'pay-at-door': 'You pay for the food only after it reaches you. Never pay a kitchen in advance or through a link sent in chat.',
  'qr-check': 'Check that the name in your UPI app matches **{registered name}** before paying. Payments made to anyone else cannot be recovered by PadosiPlate.',
  'off-platform': 'Food payments are a direct transaction between you and the kitchen. PadosiPlate does not receive, hold or refund food payments, but will help resolve disputes and can refund the platform fee.',
  cancellation: 'Free cancellation until the kitchen accepts. After acceptance, the platform fee is non-refundable. If the kitchen cancels, you get the full platform fee back plus equal PadosiPlate credit.',
  'fssai-help': 'PadosiPlate does not file applications for you and does not charge for FSSAI help. You file on the official FoSCoS portal and pay the government fee (₹100/year for Basic Registration) there. Information here is general guidance, not legal advice.',
  'tax-seller': 'You are responsible for your own income tax and GST obligations on your food sales. PadosiPlate may report your sales as required by law.',
  health: 'Food listed on PadosiPlate is not intended to diagnose, treat or prevent any disease.',
  chat: 'Chats are private between you and the kitchen. PadosiPlate may review a chat only if it is reported or an order is disputed. Be respectful; abusive users are removed.',
  community: "PadosiPlate is an independent service, not run by or affiliated with your society's association or managing committee.",
  pilot: "Pilot: you're among the first families using PadosiPlate. Features may change; tell us what to fix via Help.",
  liability: "To the extent permitted by law, PadosiPlate's liability for any order is limited to the platform fee paid for that order.",
} as const;

export type DisclaimerId = keyof typeof DISCLAIMER_DEFAULTS;
export const DISCLAIMER_IDS = Object.keys(DISCLAIMER_DEFAULTS) as DisclaimerId[];
