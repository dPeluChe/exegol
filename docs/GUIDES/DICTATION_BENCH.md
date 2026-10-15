# Dictation model bench

Compare speech models on your own dictations (Spanish mixed with English technical terms, for
example). Development only: the script is not part of the app.

## 1. Collect recordings

Settings > Dictation > Recordings > "Keep recordings for model testing". Every dictation that
ends with text inserted or copied is saved to
`~/.exegol/dictation-audio/<projectId or no-project>/<time>-<id>.wav` (16 kHz mono, 16-bit PCM)
with a `.json` next to it: model, engine version, target kind, duration, decode time, the text as
inserted (`text`) and the engine's own text when it differed (`rawText`). Folders are 0700, files
0600. They are deleted after the retention chosen there (5, 10, 15 or 30 days); turning the
setting off keeps what was saved.

The saved `text` is what the dictating model heard, so scoring that same model against it gives 0.
For a fair comparison, correct the transcript: add a `"reference": "..."` field to the `.json`
(it wins over `text`).

## 2. Run the bench

```bash
bun apps/desktop/scripts/dictation-bench.ts
bun apps/desktop/scripts/dictation-bench.ts --model ~/models/sherpa-onnx-whisper-turbo=whisper-large-v3-turbo-int8
bun apps/desktop/scripts/dictation-bench.ts --dir ./clips --no-installed --model ./my-parakeet --json bench.json
```

| Flag | Meaning |
|------|---------|
| `--dir DIR` | Recordings folder (default `~/.exegol/dictation-audio`, searched recursively) |
| `--model DIR[=id]` | An extra model folder, repeatable. The catalog id picks the sherpa-onnx config; without it the folder name, then the first family whose files are there |
| `--no-installed` | Skip the models installed in `~/.exegol/models` (used by default) |
| `--threads N` | Decoder threads (default 4) |
| `--json FILE` | Per-model rows plus every clip's reference and hypothesis |

Configs come from `src/main/dictation/model-config.ts`, the same ones the app uses.

## 3. Read the table

```
model                      clips  WER %  CER %  audio s  decode s    RTF
parakeet-tdt-0.6b-v3-int8     42    8.1    3.0    612.4      38.9  0.064
```

- WER and CER: mean per clip, after lowercasing and turning punctuation into spaces (accents
  kept). Levenshtein distance over words and characters
- RTF: decode seconds over audio seconds; below 1 is faster than real time. Whole clips are decoded
  in one pass, unlike the app, which decodes phrase by phrase while you talk
