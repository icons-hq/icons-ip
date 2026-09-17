/** Simulates the verified-upload result without contacting Storage or the server. */
export async function uploadAdminArtwork() {
  return { ok: true as const, imagePath: 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp' };
}
