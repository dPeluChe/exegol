# Local TTS research: Open TTS Leaderboard and small models

Checked on 2026-11-10. Every number below was read that day from the linked source. "Vendor" marks a figure published by the model's own author. "not verified" means it could not be confirmed.

## Summary

- The Open TTS Leaderboard is run by the Hugging Face audio team. It scores intelligibility (WER through an ASR model), speed (RTFx on an H200 GPU, plus a separate streaming tab with a CPU mode), predicted naturalness (UTMOS, English only) and speaker similarity for cloning runs. It does not test numbers, currency or symbols, and it does not rate accent. Source: https://huggingface.co/spaces/hf-audio/open_tts_leaderboard/blob/main/constants.py
- Its results dataset (`hf-audio/tts_leaderboard_results`) answered HTTP 401 without a token. The tables here were read from the running Space through its public Gradio API (`/gradio_api/call/_refresh_leaderboard` and `/_refresh_streaming`), results version 1.5.3 dated 2026-11-10.
- Of the five models in the link, three are English only (Phonon 31m, PiVo, Underdog Woof). Paradee v1.3 has one Spanish voice (male, Kokoro's `em_alex`). ZONOS3-Mini speaks Spanish with one male and one female default voice, but is an 800M-parameter model with no CPU row on the leaderboard.
- Gradium does have a Spanish Phonon: `gradium/phonon-40m-es`, 40M parameters, 74.6 MB (q8), CC BY-NC 4.0, gated with automatic approval. Its voice catalog has a "Spanish (Mexico)" section with 6 male and 6 female voices. It ranks first for Spanish on the leaderboard (WER 0.88). Sources: https://huggingface.co/gradium/phonon-40m-es , https://huggingface.co/gradium/phonon-voices
- On the leaderboard's CPU streaming test (English), Kokoro-82M needs 852 ms median and 2374 ms p95 to first audio because it has no streaming API. Phonon 31m needs 19.5 ms median, Pocket TTS 125.9 ms, Paradee v1.3 136.4 ms.
- sherpa-onnx has model types for Kokoro, Pocket TTS, Supertonic, Kitten, Matcha, VITS (Piper) and ZipVoice. It has no Phonon, ZONOS3, PiVo or Woof support. Its Pocket TTS bundle is English only; Spanish bundles need an open PR. Supertonic 3 with Spanish is supported today.
- sherpa-onnx 2.0.0 (2026-10-23) removed eSpeak NG. The app is on `sherpa-onnx-node` 1.13.8 (read from `apps/desktop/package.json`), so an upgrade changes how Spanish text reaches Kokoro.
- Supertonic's GitHub repository was archived on 2026-09-09 and development ended.
- For Spanish numbers and currency in Node: `n2words` (MIT, has `es-MX`) and `to-words` (MIT, has `es-MX`) cover number, ordinal and currency words. NeMo-text-processing (Apache-2.0) has full Spanish grammars but is Python with pynini; sherpa-onnx can load compiled rule FSTs.

## The leaderboard

Source for this section unless noted: https://huggingface.co/spaces/hf-audio/open_tts_leaderboard/blob/main/constants.py

**Who runs it.** The Hugging Face Audio Team (citation block in `constants.py`). The Space was created 2026-09-07 and last changed 2026-11-10 (https://huggingface.co/api/spaces/hf-audio/open_tts_leaderboard). Models are added by pull request or issue at https://github.com/huggingface/open-tts-leaderboard . The About text says the evaluation scripts "plan to be open-sourced".

**Metrics.**

| Metric | What it is |
|---|---|
| WER | Word error rate of a Qwen3-ASR-1.7B transcription of the generated audio against the input text, after normalization similar to the Open ASR Leaderboard. Lower is better. |
| RTFx | Audio seconds per compute second. Main tab: same GPU for all (HF Jobs `h200`, 1x H200), batch size 32 where supported, else 1. |
| UTMOS | Predicted MOS from UTMOS22, 1 to 5. English only. |
| KOMOS | Korean counterpart of UTMOS. |
| SIM | WavLM speaker-embedding cosine similarity. Voice-cloning runs only. |
| TTFA | Time to first audio, batch size 1, p50 and p95. Streaming tab. |

**Test sets.** Seed-TTS eval (English, Chinese), CV3-Eval (9 languages including Spanish), MiniMax TTS-Multilingual-Test-Set (23 languages including Spanish). Spanish scores are the average of CV3-Eval and MiniMax. The variety of Spanish in those sets is not stated on the Space: not verified.

**Streaming tab.** Batch size 1, 3 warmup samples then 497 timed samples from CV3-Eval's English split. Three hardware modes: A100 (`a100-large`), CPU (`cpu-upgrade`) and H200, all on HF Jobs. English only.

**Size and license.** The table has a "Size (B)" column (billions of parameters), license, number of languages, voice cloning, batch inference, Transformers support.

**Limits.**
- No test of numbers, currency, dates or symbols. WER is on plain sentences.
- No human listening score. UTMOS is a predictor and is English only, so there is no naturalness figure for Spanish.
- Accent or regional variety is not measured.
- Main-tab RTFx is a GPU batch figure. Some rows were run on CPU instead (footnotes: Phonon on `cpu-upgrade`, PiVo on 1 CPU thread, Woof on 8 numpy threads), so RTFx is not comparable across those rows.
- CPU figures are from an HF Jobs cloud CPU, not a Mac.
- Results dataset is not public: `https://huggingface.co/api/datasets/hf-audio/tts_leaderboard_results` returned "Invalid username or password" (HTTP 401) with no token.
- The `?listen=` link only opens the Listen tab with those five models preselected. Clips come from stored eval runs; nothing is synthesized live.

**English, no cloning, all three sets (43 models ranked). Top 20:**

| # | Model | WER | RTFx | UTMOS | Params (B) | License (as listed) |
|---|---|---|---|---|---|---|
| 1 | inclusionAI/Ming-3.0-tts-0.5B | 0.66 | 1.17 | 4.28 | 1.48 | mit |
| 2 | hexgrad/Kokoro-82M | 0.69 | 73.96 | 4.51 | 0.08 | apache 2.0 |
| 3 | sahilmahendrakar/Paradee-8M-v1.3 | 0.69 | 49.07 | 4.38 | 0.008 | apache-2.0 |
| 4 | Edge0/Audio8-TTS-Realistic-0.6b | 0.71 | 11.66 | 4.44 | 0.94 | apache-2.0 |
| 5 | sahilmahendrakar/Paradee-8M-v1.0 | 0.71 | 6.7 | 4.39 | 0.008 | apache-2.0 |
| 6 | gradium/phonon-31m-en (CPU run) | 0.73 | 4.16 | 4.45 | 0.041 | apache-2.0 |
| 7 | gradium/phonon-40m-en (CPU run) | 0.74 | 3.48 | 4.45 | 0.051 | CC-BY-NC-4.0 |
| 8 | Supertone/supertonic-3 | 0.74 | 56.73 | 4.45 | 0.1 | Open RAIL-M |
| 9 | fishaudio/s2-pro | 0.76 | 0.4 | 4.44 | 4.95 | custom |
| 10 | empero-ai/PiVo-1.4M (1 CPU thread) | 0.77 | 11.46 | 4.33 | 0.001 | apache-2.0 |
| 11 | LiquidAI/LFM3-Audio-2B | 0.8 | 14.69 | 4.45 | 2.05 | custom |
| 12 | FunAudioLLM/Fun-CosyVoice3-0.5B-2512 (RL) | 0.82 | 2.85 | 4.2 | 0.11 | cc-by-4.0 |
| 13 | kyutai/pocket-tts | 0.83 | 9.13 | 4.36 | 0.1 | cc-by-4.0 |
| 14 | Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice | 0.85 | 14.06 | 4.42 | 1.92 | apache 2.0 |
| 15 | ResembleAI/chatterbox | 0.89 | 2.22 | 4.4 | 0.8 | mit |
| 16 | LiquidAI/LFM2.5-Audio-1.5B | 0.93 | 1.92 | 4.34 | 1.53 | custom |
| 17 | microsoft/VibeVoice-Realtime-0.5B | 0.94 | 2.69 | 4.46 | 1.36 | mit |
| 18 | Zyphra/ZONOS3-Mini | 1.03 | 48.48 | 4.35 | 0.8 | apache-2.0 |
| 19 | BreezeBlue/Breeze-TTS-2 | 1.04 | 3.3 | 3.9 | 3.47 | custom |
| 20 | ConwayResearch/Underdog-Woof (8 CPU threads) | 1.08 | 12.58 | 4.45 | 0.038 | custom |

Also in the table: owensong/Inflect-Micro-v2 at rank 26 (WER 1.28, 0.009 B, apache 2.0). Source for the table: Space API, `_refresh_leaderboard`, languages English, version "latest", https://huggingface.co/spaces/hf-audio/open_tts_leaderboard

**Spanish, no cloning, CV3-Eval + MiniMax (24 models ranked). Top 12 plus two small models lower down:**

| # | Model | WER | RTFx | Params (B) | License (as listed) | Cloning |
|---|---|---|---|---|---|---|
| 1 | gradium/phonon-40m-es (CPU run) | 0.88 | 4.6 | 0.051 | CC-BY-NC-4.0 | yes |
| 2 | hexgrad/Kokoro-82M | 1.05 | 72.34 | 0.08 | apache 2.0 | no |
| 3 | k2-fsa/OmniVoice | 1.15 | 44.25 | 0.81 | cc-by-nc | yes |
| 4 | FunAudioLLM/Fun-CosyVoice3-0.5B-2512 (RL) | 1.27 | 2.88 | 0.11 | cc-by-4.0 | yes |
| 5 | sahilmahendrakar/Paradee-8M-v1.3 | 1.28 | 49.74 | 0.008 | apache-2.0 | no |
| 6 | fishaudio/s2-pro | 1.29 | 0.41 | 4.95 | custom | yes |
| 7 | Zyphra/ZONOS3-Mini | 1.35 | 35.75 | 0.8 | apache-2.0 | yes |
| 8 | inclusionAI/Ming-3.0-tts-0.5B | 1.43 | 1.15 | 1.48 | mit | yes |
| 9 | Supertone/supertonic-3 | 1.44 | 63.35 | 0.1 | Open RAIL-M | no |
| 10 | Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice | 1.5 | 14.28 | 1.92 | apache 2.0 | no |
| 11 | OpenMOSS-Team/MOSS-TTS | 1.51 | 25.33 | 8.49 | apache 2.0 | yes |
| 12 | fishaudio/drama-3 | 1.77 | 24.8 | 35.0 | custom | yes |
| 16 | nvidia/magpie_tts_multilingual_357m | 3.49 | 12.22 | 0.31 | custom | no |
| 22 | kyutai/pocket-tts | 7.26 | 9.3 | 0.1 | cc-by-4.0 | yes |

Source: same API, languages Spanish. Which Pocket TTS Spanish checkpoint (6-layer or `spanish_24l`) produced the 7.26 is not stated: not verified.

**Streaming tab, CPU mode (English, batch 1, HF Jobs `cpu-upgrade`), all 15 rows:**

| # | Model | TTFA p95 ms | TTFA p50 ms | RTFx | Streaming API |
|---|---|---|---|---|---|
| 1 | empero-ai/PiVo-1.4M (1 thread) | 6.3 | 3.1 | 14.09 | yes |
| 2 | gradium/phonon-31m-en (xn-ptts) | 28.4 | 19.5 | 16.26 | yes |
| 3 | gradium/phonon-40m-en (xn-ptts) | 38.0 | 26.4 | 14.42 | yes |
| 4 | kyutai/pocket-tts | 164.9 | 125.9 | 3.19 | yes |
| 5 | kyutai/pocket-tts (audio.cpp) | 182.3 | 73.6 | 2.49 | yes |
| 6 | LiquidAI/LFM2.5-Audio-1.5B (audio.cpp) | 341.1 | 273.6 | 1.2 | yes |
| 7 | sahilmahendrakar/Paradee-8M-v1.3 | 347.6 | 136.4 | 33.1 | no |
| 8 | LiquidAI/LFM3-Audio-2B | 871.6 | 689.9 | 0.16 | yes |
| 9 | ConwayResearch/Underdog-Woof | 934.5 | 495.2 | 8.46 | no |
| 10 | sahilmahendrakar/Paradee-8M-v1.0 | 996.9 | 390.1 | 11.48 | no |
| 11 | owensong/Inflect-Micro-v2 | 1292.4 | 526.7 | 8.18 | no |
| 12 | ConwayResearch/Underdog-Woof (Mira) | 1730.5 | 658.6 | 4.7 | no |
| 13 | hexgrad/Kokoro-82M (photon) | 2259.6 | 803.3 | 5.39 | no |
| 14 | hexgrad/Kokoro-82M | 2373.6 | 852.2 | 5.46 | no |
| 15 | Supertone/supertonic-3 (audio.cpp) | 4371.8 | 1552.8 | 3.03 | no |

Source: Space API, `_refresh_streaming`, mode CPU. ZONOS3-Mini has no CPU row; on A100 it shows TTFA p50 35.9 ms, p95 80.5 ms, RTFx 13.1 (same API, mode A100). For models with no streaming API, TTFA is the time to synthesize the whole sample.

## Model comparison

Leaderboard figures (LB) come from the tables above. Sizes are file sizes from the Hugging Face API (`https://huggingface.co/api/models/<id>?blobs=true`).

| Model | License / commercial | Params, download | Languages / Spanish | Voices / cloning | Streaming | Runtimes | CPU speed | Text normalization | Updated |
|---|---|---|---|---|---|---|---|---|---|
| Paradee-8M v1.3 [1] | Apache-2.0 / yes | 7.88M; 8.5 MB int8 ONNX, 35 MB fp32 | en, hi, fr, es. One Spanish voice | 8 fixed (Spanish: `em_alex`, male). No cloning | No streaming API (LB) | ONNX; Python package; `tokenizer.json` for transformers.js / kokoro-js. No GGUF, MLX, CoreML | Vendor: about 62x real time, 1 thread, M4 Pro. LB CPU: RTFx 33.1, TTFA p50 136 ms | Left to the caller. Needs Kokoro-style phonemes; Spanish through eSpeak NG via misaki. Card: numbers only as well as misaki and eSpeak handle them | 2026-11-09 |
| Phonon 31m en [2] | Apache-2.0 / yes | 31M (41.1M with tokenizer in safetensors); 64.5 MB q8 GGUF, 55.1 MB q4k | English only | About 100 catalog voices; cloning through Gradium Studio (API key) | Yes, 80 ms frames | Own Rust runtime `xn-ptts` (MIT or Apache-2.0): CLI binaries for macOS, Linux, Windows; Python; Wasm (browser only, "not Node.js"); CoreML (Swift); C library; Transformers. GGUF. No ONNX | Vendor: 26x and 5 ms TTFB on 1 MacBook Air M5 core. LB CPU: RTFx 16.26, TTFA p50 19.5 ms | Built into the runtime, per `lang` (numbers, currency, dates, emails). Not in the Transformers path | 2026-10-22 |
| Phonon 40m es [3] | CC BY-NC 4.0 / no. Gated, automatic approval | 40M (50.5M in safetensors); 74.6 MB q8, 60.4 MB q4k | Spanish. Vendor Elo table labels it "Spanish (Spain)"; catalog has Spain and Mexico voices | Catalog: Spain 7 F / 6 M, Mexico 6 F / 6 M (male: Lalo, Aldo, Yael, Ulises, Leonel, Nico). Cloning via Gradium Studio | Yes | Same as Phonon 31m. CoreML bundle published only for 31m; 40m needs own export | Vendor: 20x and 7 ms TTFB on 1 M5 core. LB (40m-en, CPU): RTFx 14.42, TTFA p50 26.4 ms. LB Spanish WER 0.88 | Built in, `lang=es`. Mexican-specific handling (pesos and so on): not verified | 2026-10-28 |
| PiVo-1.4M [4] | Apache-2.0 (vocoder code BSD, CMU dict license) / yes | 1.40M; 5.8 MB ONNX total | English only | 2 (Pi, Vo). No cloning | Yes, 10 ms frames after full encode | ONNX (4 graphs) + NumPy | LB CPU: RTFx 14.09, TTFA p50 3.1 ms, 1 thread | Built in: numbers, currency, ordinals, ISO dates. Errors on words outside the CMU dictionary | 2026-11-01 |
| ZONOS3-Mini [5] | Weights Apache-2.0, code MIT / yes | 800M total, about 100M active per token; 0.66 GB backbone GGUF + 452 MB decoder; whole `gguf/` 9.3 GB | 43 languages incl. Spanish. Variety not stated | 27 default voices; Spanish: Rodrigo (male), Ximena (female). Cloning from a clip or 192-d embedding | Yes | C++/ggml (CPU, CUDA, Metal, Vulkan), MLX, WebGPU, PyTorch/CUDA, SGLang. GGUF. No ONNX | No CPU figure published or on LB: not verified. LB A100: RTFx 13.1, TTFA p50 35.9 ms | NeMo normalization for 9 languages incl. Spanish. In the ggml server it is an optional separate Python helper | 2026-11-10 |
| Underdog Woof [6] | Underdog Non-Commercial 1.0 / no (commercial license by request; credit required; 30-day company trial) | 38.24M; 40.6 MB | English only | 2 (Juno, Mira). No cloning | No streaming API (LB) | NumPy only (`.npz`). No ONNX, GGUF | Vendor: 13.8x (Juno), 7.2x (Mira), 1 thread, M5 Max. LB CPU: RTFx 8.46, TTFA p50 495 ms | Built in, rule-based, English | 2026-11-06 |
| Supertonic 3 [7] | OpenRAIL-M (use restrictions; no non-commercial clause seen in the part read) / code MIT | About 99M; 398 MB fp32 ONNX; 129 MB int8 sherpa-onnx archive | 31 languages incl. Spanish (`es`). Variety not stated | Fixed preset styles (M1.., F1..). No cloning in the open weights; Voice Builder closed 2026-08-31 | No streaming API (LB) | ONNX Runtime: Node.js, browser (WebGPU/WASM), C++, Swift, Rust and more. sherpa-onnx. Repo archived 2026-09-09, no further development | Vendor: no number read ("fast on CPU"). LB CPU (audio.cpp): RTFx 3.03, TTFA p50 1553 ms | Vendor claims it reads currency, phone numbers, units from raw text; examples are English. Spanish: not verified | 2026-05-18 |
| Pocket TTS [8] | CC BY 4.0 / yes with attribution. Gated, automatic; prohibited-use terms | 100M; Spanish 219 MB, `spanish_24l` 672 MB (safetensors) | en, fr, de, pt, it, es. Variety not stated | Catalog of voice embeddings (27 in the Spanish folder); cloning from a wav | Yes | PyTorch CPU; community ONNX, MLX, Rust/Wasm, C++; sherpa-onnx (English bundle) | Vendor: about 6x real time and about 200 ms first chunk, MacBook Air M4, 2 cores. LB CPU: RTFx 3.19, TTFA p50 126 ms. LB Spanish WER 7.26 | Not documented in the part read: not verified | 2026-10-21 |
| Kokoro-82M (current) [9] | Apache-2.0 / yes | 82M; 327 MB `.pth`; 132 MB int8 sherpa-onnx archive | 8 languages on LB. Spanish: 1 F, 2 M, eSpeak NG `es` | Fixed voices. No cloning | No streaming API (LB) | PyTorch, ONNX, sherpa-onnx, kokoro-js | LB CPU: RTFx 5.46, TTFA p50 852 ms, p95 2374 ms | Left to the front end (misaki / eSpeak NG) | 2025-04-10 |
| Inflect-Micro-v2 [10] | Apache-2.0 / yes | 9M (LB); 37.5 MB `.pth` | English only | Not checked | No streaming API (LB) | PyTorch; sherpa-onnx archives `vits-inflect-en-micro-v2`, `-nano-v2` | LB CPU: RTFx 8.18, TTFA p50 527 ms | Not checked | 2026-10-10 |

Sources:
[1] https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3 , https://github.com/sahilmahendrakar/paradee
[2] https://huggingface.co/gradium/phonon-31m-en , https://github.com/gradium-ai/xn-ptts , https://www.npmjs.com/package/phonon-tts
[3] https://huggingface.co/gradium/phonon-40m-es , https://huggingface.co/gradium/phonon-voices , https://github.com/gradium-ai/xn-ptts
[4] https://huggingface.co/empero-ai/PiVo-1.4M
[5] https://huggingface.co/Zyphra/ZONOS3-Mini , https://github.com/Zyphra/ZONOS3-Mini , https://github.com/Zyphra/ZONOS3-Mini/blob/main/servers/ggml/README.md , https://huggingface.co/Zyphra/ZONOS3-Mini/blob/main/gguf/voices/README.md
[6] https://huggingface.co/ConwayResearch/Underdog-Woof , https://huggingface.co/ConwayResearch/Underdog-Woof/blob/main/LICENSE
[7] https://huggingface.co/Supertone/supertonic-3 , https://github.com/supertone-oss-archive/supertonic , https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE
[8] https://huggingface.co/kyutai/pocket-tts , https://github.com/kyutai-labs/pocket-tts
[9] https://huggingface.co/hexgrad/Kokoro-82M , https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
[10] https://huggingface.co/owensong/Inflect-Micro-v2

Other vendor comparisons worth knowing, both on English "hard" sentences full of numbers, dates and codes (dataset https://huggingface.co/datasets/gradium/tts-hard-sentences-202610 , CC BY 4.0, languages en, fr, es, pt, de):
- Gradium, vendor: hard-set LLM WER for Spanish (Spain): phonon-40m-es 2.1%, phonon-40m-multilingual 2.6%, Kokoro 3.8%, Magpie 25%, NeuTTS 16%. Blind-test Elo: phonon-40m-es 2103, Kokoro 1629 (201 raters, 2,290 votes). https://huggingface.co/gradium/phonon-31m-en
- Underdog, vendor, English only: Woof 1.42%, Phonon 31m 2.16%, Kokoro 5.17%, Pocket TTS 8.07%, Supertonic 3 8.81%, Kitten Nano 0.8 9.81%. https://huggingface.co/ConwayResearch/Underdog-Woof

## Spanish

- **Phonon 40m es.** Exists. Spanish only, 24 kHz, CC BY-NC 4.0, so no commercial use without a separate agreement (the xn-ptts README says more languages are "available on request"; commercial terms for 40m: not verified). Gated: files need a Hugging Face account that accepted the terms and a token; approval is automatic. A `phonon-40m-multilingual` (en, fr, de, es, pt in one model, same size and license) also exists. https://huggingface.co/gradium/phonon-40m-es , https://github.com/gradium-ai/xn-ptts
- **Mexican voices for Phonon.** `gradium/phonon-voices` (Apache-2.0) lists "Spanish (Mexico)": female Rebeca, Regina, Danae, Azucena, Jimena, Ximena; male Lalo, Aldo, Yael, Ulises, Leonel, Nico. The catalog page says the voices and samples are for Phonon S (31M), which is English only; the 40m-es card uses a catalog voice (Iker, es-es) with the Spanish model. How the Mexican voices sound on 40m-es: not verified (no listening done). https://huggingface.co/gradium/phonon-voices
- **Paradee v1.3.** One Spanish voice, `em_alex` (male), distilled from Kokoro. Vendor figures for that voice: UTMOS 3.14 (Kokoro 3.34), WER 5.0% (Kokoro 5.1%) with Whisper large-v3 on 200 sentences. Phonemes come from eSpeak NG `es`. https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3
- **Kokoro.** Spanish voices: 1 female, 2 male, phonemized with eSpeak NG `es`. The card warns non-English support "may be absent or thin due to weak G2P and/or lack of training data". eSpeak NG lists two Spanish variants: `es` (Spain) and `es-419` (Latin American). https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md , https://github.com/espeak-ng/espeak-ng/blob/master/docs/languages.md
- **ZONOS3-Mini.** Spanish default voices Rodrigo (male) and Ximena (female); accent of each not stated. An accent adapter file (`gguf/edit/accents.gguf`, 257 MB) and voice cloning exist; whether a Mexican accent is offered: not verified. https://huggingface.co/Zyphra/ZONOS3-Mini/blob/main/gguf/voices/README.md
- **Supertonic 3.** Spanish is one of 31 language codes; fixed preset voices shared across languages. Vendor WER for Spanish 1.13 on its own MiniMax-based test. Variety: not verified. https://github.com/supertone-oss-archive/supertonic
- **Pocket TTS.** Spanish in two sizes (6-layer 219 MB, 24-layer 672 MB; the README says the 24-layer variants are higher quality but slower). Leaderboard Spanish WER 7.26, the weakest of the small models. https://github.com/kyutai-labs/pocket-tts
- **Piper voices already packaged for sherpa-onnx.** `vits-piper-es_MX-claude-high` (int8 archive 21 MB) and `vits-piper-es_MX-ald-medium`. Model cards say es_MX, one speaker, 22,050 Hz; gender is not stated on the cards: not verified. Not on the leaderboard. https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models , https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_MX
- **English-only among the candidates:** Phonon 31m, PiVo, Underdog Woof, Inflect.

## Runtimes and fit with sherpa-onnx

Current state: the app pins `sherpa-onnx-node` 1.13.8; the latest is 2.0.1 (2026-10-26). https://www.npmjs.com/package/sherpa-onnx-node , https://github.com/k2-fsa/sherpa-onnx/releases

**TTS model types in sherpa-onnx source** (`offline-tts-*-model-config.h`): kitten, kokoro, matcha, pocket, supertonic, vits, zipvoice. https://github.com/k2-fsa/sherpa-onnx/tree/master/sherpa-onnx/csrc

| Model | In sherpa-onnx? | Notes |
|---|---|---|
| Kokoro-82M | Yes | `kokoro-multi-lang-v1_0` (53 speakers, includes `ef_dora`, `em_alex`), int8 archive 132 MB. Docs label it "Chinese + English". https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html |
| Supertonic 3 | Yes | `sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2`, 129 MB, `--lang es`, `--sid` picks the speaker. https://k2-fsa.github.io/sherpa/onnx/tts/supertonic.html |
| Pocket TTS | English only | Bundle `sherpa-onnx-pocket-tts-int8-2026-01-26` (98 MB). Issue #3755 (open): newer and French exports do not work. PR #4148 (open, 2026-10-30) adds a script so community Spanish, German, Italian, Portuguese and French ONNX bundles work; its author reports real-time factor 0.4 to 1.0 on an 8-core desktop CPU (third-party figure). https://github.com/k2-fsa/sherpa-onnx/issues/3755 , https://github.com/k2-fsa/sherpa-onnx/pull/4148 |
| Paradee | Not packaged | Issue #4139: a third party reports Paradee v1.2 "loads as an ordinary Kokoro model after a small graph edit" in sherpa-onnx 2.0.1 and offers an export script. v1.3 and Spanish through sherpa-onnx: not verified. https://github.com/k2-fsa/sherpa-onnx/issues/4139 |
| Piper es_MX | Yes | VITS archives listed above. |
| Kitten, Inflect, Matcha, ZipVoice | Yes | English or Chinese/English only. https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models |
| Phonon | No | No issue or PR found. Runs on its own runtime, GGUF weights. |
| ZONOS3-Mini | No | Own ggml / MLX / WebGPU runtimes. |
| PiVo | No | Own ONNX + NumPy runtime. |
| Underdog Woof | No | NumPy only. |

**sherpa-onnx 2.0 change that affects Spanish.** PR #4055 (in 2.0.0) removed eSpeak NG and piper-phonemize. Text front ends are now a built-in lexicon, or phonemes computed outside and passed in (`phoneme_codepoints` or `tokens` in the generation config); `data_dir` is ignored. Issue #4139 reports that in 2.0.1 the Kokoro English lexicon front end drops numbers and unknown words ("The budget is 1969 dollars" is spoken as "The budget is dollars"). The maintainer's answer: numbers should be handled with rule FSTs, and unknown words are ignored by design. Whether a Spanish lexicon ships for Kokoro in 2.x: not verified. https://github.com/k2-fsa/sherpa-onnx/pull/4055 , https://github.com/k2-fsa/sherpa-onnx/issues/4139

**Running Phonon from an Electron app (facts only).**
- `phonon-tts` on npm (0.7.0, 2026-11-09, MIT or Apache-2.0, 16.5 MB unpacked) is WebAssembly for browsers with a Worker; the README says it "runs in browsers, not Node.js". An Electron renderer is a browser context; this was not tested. https://www.npmjs.com/package/phonon-tts
- Prebuilt `ptts` command-line binaries exist for macOS (Apple silicon and Intel), Linux x64/ARM64 and Windows x64. A C library (`ptts.h`, `libptts_ffi`) is built from source. There is an OpenAI-compatible local server and a WebSocket server. No Node native addon was found. https://github.com/gradium-ai/xn-ptts
- The browser package cannot fetch gated repos, so a 40m model must be served from local files. https://github.com/gradium-ai/xn-ptts

**Other formats.** ONNX: Paradee, PiVo, Supertonic 3, Kokoro, Pocket (community). GGUF/ggml: Phonon, ZONOS3-Mini. MLX: ZONOS3-Mini, Pocket (community). CoreML: Phonon (31m bundle published). WebGPU: ZONOS3-Mini, Supertonic 3. Sources as in the table above.

## Text normalization

What each model does by itself is in the comparison table. Summary for Spanish: only Phonon (runtime, `lang=es`) and ZONOS3-Mini (NeMo, Spanish included) document built-in Spanish normalization. Kokoro, Paradee and the Piper voices leave numbers to eSpeak NG or the caller.

Options usable from Node or as data rules:

| Option | License | Size | What it covers | Notes |
|---|---|---|---|---|
| n2words 6.3.0 | MIT | Vendor: about 2.5 to 3.5 KB gzipped per language; 5.1 MB unpacked for all | Cardinal, ordinal, currency words. Source has `es`, `es-ES`, `es-MX`, `es-US` | Zero dependencies, published 2026-09-30. Converts a number; finding numbers, symbols and abbreviations in text is the caller's job. https://www.npmjs.com/package/n2words , https://github.com/forzagreen/n2words |
| to-words 7.4.2 | MIT | 10.4 MB unpacked (137 locales) | Numbers, currency amounts, ordinals. Has `es-MX`, `es-ES`, `es-AR`, `es-US` locale files | Zero dependencies, published 2026-11-09. Same limit as above. https://www.npmjs.com/package/to-words , https://github.com/mastermunj/to-words |
| written-number 0.11.1 | MIT | 215 KB unpacked | Cardinals; `lang: 'es'` | Last published 2021. https://www.npmjs.com/package/written-number |
| numero-a-letras 1.0.6 | MIT | 7.7 KB unpacked | Number to Mexican pesos text | Last published 2019. https://www.npmjs.com/package/numero-a-letras |
| CLDR RBNF data (`cldr-rbnf` 49.0.0) | Unicode-3.0 | 804 KB unpacked, all locales | Spellout and ordinal rule sets for `es`; `es-419` has ordinal rules only; no `es-MX` file | Data only: needs a rule interpreter. Whether Node's built-in Intl can run these rules: not verified. https://www.npmjs.com/package/cldr-rbnf , https://github.com/unicode-org/cldr-json/tree/main/cldr-json/cldr-rbnf/rbnf |
| NeMo-text-processing, Spanish grammars | Apache-2.0 | Compiled grammar size: not verified | Cardinal, ordinal, decimal, fraction, date, time, money, measure, telephone, electronic (URLs, emails), whitelist (abbreviations) | Python with pynini; pip install is not supported on macOS or Windows (conda instead). Not usable from Node directly. Grammars can be compiled to FST/FAR files. https://github.com/NVIDIA/NeMo-text-processing , https://github.com/NVIDIA/NeMo-text-processing/tree/main/nemo_text_processing/text_normalization/es |
| sherpa-onnx rule FSTs | Apache-2.0 (sherpa-onnx) | Depends on the rules | Whatever the FST encodes | `OfflineTtsConfig` has `rule_fsts` and `rule_fars`. The maintainer points to NeMo grammars as a source of rules. No ready-made Spanish rule file was seen among the `tts-models` release assets. https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-tts.h , https://github.com/k2-fsa/sherpa-onnx/issues/4139 |
| eSpeak NG | GPL-3.0 | 7.3 MB data archive (sherpa-onnx `espeak-ng-data.tar.bz2`) | Phonemizer for `es` and `es-419`; current path for Kokoro Spanish | Removed from sherpa-onnx in 2.0.0. How well it expands "#37", currency and abbreviations in Spanish: not verified. https://github.com/espeak-ng/espeak-ng/blob/master/docs/languages.md |

Options list, facts only:
1. Keep Kokoro on sherpa-onnx 1.13.8 and add a Spanish normalizer in front (n2words or to-words for numbers and money, own rules for symbols and abbreviations). Latency stays as measured: Kokoro has no streaming API.
2. Paradee v1.3 as a smaller Kokoro-compatible model: Apache-2.0, 8.5 MB, one Spanish male voice, same phoneme front end, so the same normalization need. sherpa-onnx loading reported by a third party for v1.2 only.
3. Supertonic 3 through sherpa-onnx: supported today with Spanish, OpenRAIL-M, upstream archived. Leaderboard CPU first-audio time is higher than Kokoro's.
4. Pocket TTS Spanish through sherpa-onnx: needs PR #4148 or the script in it; streaming model; leaderboard Spanish WER 7.26; CC BY 4.0, gated.
5. Phonon 40m es on its own runtime: lowest first-audio time and best Spanish WER on the leaderboard, Mexican voices in the catalog, built-in Spanish normalization; CC BY-NC 4.0 and gated, and a second runtime beside sherpa-onnx.
6. ZONOS3-Mini: Apache-2.0, Spanish male voice, cloning; 800M parameters, at least about 1.1 GB of GGUF files, no published CPU figure.
7. Piper es_MX voices on sherpa-onnx: already packaged, 21 MB int8; not on the leaderboard.

## Open questions / not verified

- No audio was listened to. Voice quality, accent and how each model reads "#37", prices or abbreviations in Spanish were not tested.
- No model was run on a Mac. All CPU figures are either the leaderboard's HF Jobs CPU or vendor figures.
- The leaderboard's raw CSVs could not be downloaded (401 without a token). Tables came from the Space's public API and match what the page shows for version "latest" (1.5.3).
- Files of the gated repos (`gradium/phonon-40m-es`, `kyutai/pocket-tts`) were not downloaded; their cards and file lists are public and were read. Getting the weights needs a Hugging Face login that accepted the terms.
- Which Spanish variety the leaderboard's Spanish test sets and each model's training data use (except Phonon's "Spanish (Spain)" Elo label and its Mexico voice section).
- Whether Phonon's `lang=es` normalizer handles Mexican conventions (pesos, "$" as pesos); its normalizer source was not located in the repository tree.
- Whether Gradium licenses the 40m models for commercial use, and on what terms.
- Whether the Mexican catalog voices work as well on `phonon-40m-es` as the samples (recorded on the 31M model) suggest.
- ZONOS3-Mini real-time factor on CPU or Apple silicon; memory use; whether its accent controls include Mexican Spanish.
- Paradee v1.3 in sherpa-onnx (only v1.2 was reported, by a third party), and whether sherpa-onnx 2.x ships any Spanish lexicon for Kokoro.
- Gender of the Piper `es_MX` voices (`claude`, `ald`).
- Supertonic 3: Spanish text normalization, CPU speed numbers, number of preset voices, full OpenRAIL-M restriction list (only the start of the license was read).
- Pocket TTS: text normalization behavior, which Spanish checkpoint the leaderboard used, voice licenses per voice.
- Size of a compiled NeMo Spanish FST/FAR, and whether sherpa-onnx 1.13.8 accepts it for Kokoro's Spanish path.
- Whether Node's built-in Intl can spell out numbers (so CLDR RBNF data would need a separate interpreter).
- sherpa-onnx docs page for Pocket TTS returned 404 at the URL tried; Pocket support was confirmed from the source tree, release assets and issues instead.
