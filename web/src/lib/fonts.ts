import { Public_Sans, Source_Serif_4 } from "next/font/google";

/** Interface text: an institutional sans (designed for public-sector forms). */
export const uiFont = Public_Sans({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

/** Proposals and quoted resolutions: a text serif, as legal wording reads in the minute book. */
export const textFont = Source_Serif_4({ subsets: ["latin"], variable: "--font-text", display: "swap" });

/** Put on a container to use both faces inside it (`font-ui` / `font-text` utilities). */
export const fontVars = `${uiFont.variable} ${textFont.variable}`;
