import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PhaDinCafe",
    short_name: "PhaDinCafe",
    description: "Order ahead, track your order, and earn loyalty points.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff8f2",
    theme_color: "#b3341f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
