# Credits and licenses

All 3D models (cafe, Madame Lune, money, decor, ghost hand) are procedural geometry
written for this project in `src/models/` and `src/cafe-builder.ts`. All sound effects
and the cafe ambience are synthesized at runtime with WebAudio (`src/audio/`). No
third-party art or audio files are used.

## Libraries

| Library | License |
| --- | --- |
| Immersive Web SDK (`@iwsdk/*`) | MIT |
| three.js (`super-three`) | MIT |
| pmndrs UIKit (`@pmndrs/uikit*`) | MIT |
| Lucide icons (via `@pmndrs/uikit-lucide`) | ISC |
| Anthropic TypeScript SDK (`@anthropic-ai/sdk`) | MIT |
| Transformers.js (`@huggingface/transformers`) and ONNX Runtime Web | Apache-2.0, MIT |

## Models (downloaded at runtime from the Hugging Face CDN)

| Model | Use | License |
| --- | --- | --- |
| OpenAI Whisper tiny (`onnx-community/whisper-tiny`, ONNX conversion of `openai/whisper-tiny`) | On-device French speech recognition | Apache-2.0 |
| Meta MMS-TTS French (`Xenova/mms-tts-fra`, ONNX conversion of `facebook/mms-tts-fra`) | On-device French voice when the browser has none | **CC-BY-NC 4.0**: attribution, non-commercial use only |
| Claude (Anthropic API) | Madame Lune's conversation and tool calls | Anthropic commercial terms |

MMS-TTS: Pratap et al., "Scaling Speech Technology to 1,000+ Languages" (Meta AI, 2023).
It is used here in a free, non-commercial competition entry. Replace it (for example with
a licensed cloud voice through a server route) before any paid release.

## Fonts

Poppins (Regular, Bold) by Indian Type Foundry, SIL Open Font License 1.1
(`public/ui/fonts/OFL-NOTICE.txt`).

## Other files

`public/audio/chime.mp3` came with the original project scaffold and is not used by the
app. Confirm its source, or delete it, before publishing the repository.
