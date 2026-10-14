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
(it wins over `text`), for example:

```json
{ "version": 1, "modelId": "parakeet-tdt-0.6b-v3-int8", "text": "corre el work tree", "reference": "corre el worktree", ... }
```

Only the corrected clips make a model's score comparable; the rest are graded against what the
dictating model wrote.

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
| `--language en\|es` | Language for models that run in a set one (Canary); default en |
| `--vocab FILE` | Terms, one per line, applied to models that take a vocabulary (Parakeet, Qwen3-ASR); none by default |
| `--boost N` | Hotword score with `--vocab` (default 3) |
| `--json FILE` | Per-model rows plus every clip's reference and hypothesis |
| `--save` | Merge the run's scores into `~/.exegol/dictation-bench/results.json` for Settings > Models |

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

## 4. See it in Settings > Models

`--save` writes `~/.exegol/dictation-bench/results.json` (folder 0700, file 0600, the last 20
runs). Each run keeps the time, clip count, audio seconds, language, the vocabulary's term count
and hash (never the words) and per model: WER, CER, RTF, decode seconds, clips, `correctedClips`
(had a `reference`), `selfScoredClips` (no `reference` and dictated with this same model) and
`reference` (`corrected` only when every clip had one). No text and no audio go in it.

Settings > Models reads only that file (the newest run per language). Each model card shows
"Your tests" with a "N corrected" or "self-scored" badge; the ranking for the dictation language
puts models with corrected clips first, by your WER, then the rest by public WER. Short version:
keep recordings, correct a few texts, run the bench with `--save` and `--language`.
