import type { DetailedHTMLProps, HTMLAttributes } from "react"

type ModelViewerAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  poster?: string
  alt?: string
  "camera-orbit"?: string
  "field-of-view"?: string
  exposure?: string
  "shadow-intensity"?: string
  loading?: "auto" | "lazy" | "eager"
  reveal?: "auto" | "interaction" | "manual"
}

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes
    }
  }
}
