/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    "video-stream": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      mode?: string
    }
  }
}
