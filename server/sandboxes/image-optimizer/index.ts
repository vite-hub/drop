import sharp from "sharp"

export default async function optimizeImage({ image }: { image: Blob }) {
  const optimized = await sharp(await image.arrayBuffer())
    .rotate()
    .resize({
      fit: "inside",
      height: 2048,
      width: 2048,
      withoutEnlargement: true,
    })
    .toBuffer()

  return new Blob([Uint8Array.from(optimized)], { type: image.type })
}
