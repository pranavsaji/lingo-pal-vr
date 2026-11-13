# Credits and licenses

Sound effects and the café ambience are synthesized at runtime with WebAudio
(`src/audio/`); no audio files are used. Money, the tray, register, decor, ghost hand,
the cheese, the macarons, the menu card and the cartoon fallback shopkeeper are
procedural geometry written for this project.

## Characters

Madame Lune, Monsieur Paul and Madame Rose are Microsoft Rocketbox avatars
Female_Adult_05, Male_Adult_05 and Female_Adult_02
(https://github.com/microsoft/Microsoft-Rocketbox), © 2020 Microsoft, MIT License.
Converted to glTF for this project; license text in
`public/models/characters/LICENSE-Rocketbox.txt`.

## Realistic props, surfaces and environments

From Poly Haven (https://polyhaven.com), CC0 (public domain, no attribution required;
credited with thanks). Downloaded and optimized by `scripts/fetch-assets.mjs`.
- Models: croissant, food_apple_01, strawberry_chocolate_cake, carrot_cake,
  hamburger_buns, wine_bottles_01, ceramic_vase_01, painted_wooden_chair_01,
  hanging_industrial_lamp, wooden_cutting_board, wicker_basket_01, wooden_crate_01,
  bananas, food_pears_asian_01, lemon, yellow_onion, sweet_potato, food_kiwi_01,
  food_avocado_01, food_pomegranate_01 (plus potted_plant_01, round_wooden_table_01,
  standing_chalkboard_01 prepared but unused).
- Models (continued): tea_set_01 (the café cup, saucer, plate and teapot are cut from it).
- Textures: marble_01, dark_wood, oak_veneer_01, wood_floor, old_wood_floor,
  cobblestone_floor_04, wood_table_worn (plus checkered_pavement_tiles,
  red_brick_plaster_patch_02 and terracotta_floor_tiles, prepared but unused).
- 360° environments (backdrop + lighting): comfy_cafe, decor_shop, leadenhall_market.
  Shop names and brand lettering in the Leadenhall Market photo are blurred so no real
  trademarks are shown.

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
| OpenAI Whisper base (`onnx-community/whisper-base`, ONNX conversion of `openai/whisper-base`; `?stt=tiny` uses whisper-tiny) | On-device French speech recognition | Apache-2.0 |
| Meta MMS-TTS French (`Xenova/mms-tts-fra`, ONNX conversion of `facebook/mms-tts-fra`) | On-device French voice when the browser has none | **CC-BY-NC 4.0**: attribution, non-commercial use only |
| Claude (Anthropic API) | Madame Lune's conversation and tool calls | Anthropic commercial terms |

MMS-TTS: Pratap et al., "Scaling Speech Technology to 1,000+ Languages" (Meta AI, 2023).
It is used here in a free, non-commercial competition entry. Replace it (for example with
a licensed cloud voice through a server route) before any paid release.

## Photo-scanned breads and pastries

From ambientCG (https://ambientcg.com), CC0: 3DBread003, 3DBread004, 3DBread006,
3DBread007, 3DBread010, 3DBread011, 3DPastry001, 3DPastry002, 3DPastry003. Converted from
OBJ with their color, normal and ambient-occlusion maps by `scripts/fetch-assets.mjs`.

## Sketchfab models via Objaverse (CC-BY 4.0)

Mirrored by the Allen Institute's Objaverse dataset; normalized (size, texture
resolution, glass without refraction) by `scripts/fetch-objaverse.mjs`.
License: Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).

| Used as | Title | Author | Source |
| --- | --- | --- | --- |
| l'orange | Tangerine | maestronoov | https://sketchfab.com/3d-models/e5015b222a6949478d68bd6b38fc6ee0 |
| l'éclair | Caramel Macchiato Donut | tsd1 | https://sketchfab.com/3d-models/7be5302628084c94a964cd703cbce9dd |
| la tarte aux cerises | Cherry Pie - #3December2020 Day8 | LordDiego | https://sketchfab.com/3d-models/37e00109d5b04b859f7116742a9c3955 |
| la bouteille d'eau | Plastic Water Bottle | JeremyGrayson | https://sketchfab.com/3d-models/efa1c4c1f2a947659ded2e61e20eff31 |
| le verre | Wine Glass | RubberMan | https://sketchfab.com/3d-models/be365d4a32184764abc4634c1280e6da |
| la fleur | Orchid from Poly by Google | ie-niels | https://sketchfab.com/3d-models/d2c1afc47ba54d4491ee7b55469d11c8 |

Changes: rescaled, re-centered, simplified, textures resized to 512 px WebP, glass
transmission replaced by alpha blending.

## Fonts

Poppins (Regular, Bold) by Indian Type Foundry, SIL Open Font License 1.1
(`public/ui/fonts/OFL-NOTICE.txt`).

## Other files

`public/audio/chime.mp3` came with the original project scaffold and is not used by the
app. Confirm its source, or delete it, before publishing the repository.
