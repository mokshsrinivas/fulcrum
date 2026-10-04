# Fulcrum

A daily word game: you get two words and type the one that sits exactly between them in meaning.

Score = balance × relevance, out of 100. Five pairs a day, one guess each, the same pairs for everyone.

## Run it

```bash
npm run dev
```

Then open http://localhost:5173. The site is fully static; everything in `public/` can be hosted as-is.

## Rebuilding the data

`public/data/` is checked in. To regenerate it after changing `tools/pairs.txt` or the vocabulary rules, download
[numberbatch-en-19.08.txt.gz](https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-en-19.08.txt.gz) and run:

```bash
npm install
npm run build:data -- path/to/numberbatch-en-19.08.txt.gz
```

## Data credits

- Word vectors in `public/data/vectors.bin` are derived from [ConceptNet Numberbatch 19.08](https://github.com/commonsense/conceptnet-numberbatch),
  licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). That file is shared under the same licence.
- Word frequency order comes from SUBTLEX-US, via the `subtlex-word-frequencies` package.
