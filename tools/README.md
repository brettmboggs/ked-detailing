# tools

Image pipeline for the Instagram row on the home page.

```bash
python3 -m venv tools/.venv && tools/.venv/bin/pip install numpy pillow

# 1. pull the feed — store the token first (prompts, nothing to paste inline)
./tools/set-token.sh
tools/.venv/bin/python tools/fetch_instagram.py --out tools/feed --limit 25

# 2. score it, reject the weak ones, grade the keepers
tools/.venv/bin/python tools/curate.py tools/feed --out src/assets/instagram --top 4
```

Either step works on its own. `curate.py` takes any folder, which is how it is
tested against the archive on the SSD.

## The token

Run `./tools/set-token.sh` and paste at the prompt. The value never appears in
a command line, in shell history, or in a chat message, and the script refuses
placeholder text and anything under 60 characters — both of which have already
happened once, because an example command with a placeholder in it is a command
someone will run verbatim.

`fetch_instagram.py` then reads `IG_TOKEN` from the environment, falling back to
`tools/.env`. Both are gitignored; the value is never printed or logged.
Verified with `git check-ignore -v tools/.env`.

Authorising the app is not the same as having a token. Authorising produces a
short-lived code; that has to be exchanged for a long-lived token, which is
what goes in the file. The quickest route is the Meta app dashboard under
Instagram → API setup, which will hand back a long-lived token directly.

Long-lived tokens last 60 days. `--refresh-token` extends one and is what a
scheduled action would call monthly.

Until a token is in place the four images in `recent` are hand-picked, and no
copy on the site claims the row is live. A stale "latest posts" strip that has
not moved in six months is worse than an honest one.

## What the scoring actually does

No opinion about whether a photograph is nice. Six measures, each checkable,
and every rejection names the one that failed:

| measure | rejects |
| --- | --- |
| short edge | under 900px |
| focus | Laplacian variance under 55 on a 1024px-normalised frame |
| blown highlights | over 3.5% of pixels at 255 — unrecoverable |
| crushed blacks | over 42% at 0 |
| contrast | luminance std dev under 26 |
| colour cast | over 30 across near-neutral pixels |

Two of those are deliberately domain-specific:

- **Blown and crushed are judged separately.** Car photography sits in deep
  shadow on purpose. Adding them together threw out the caliper macros, which
  are meant to be dark.
- **Cast is measured on near-neutral pixels only.** Across the whole frame a
  blue van reads as a blue cast, and the van shot got rejected for being blue.

Survivors are ranked on what survives a grade — detail and resolution — because
contrast and cast are recoverable and should not decide the ordering.

## What the grade does

The same intent as the video grade: neutralise the cast, then build contrast.
White balance is taken from the brightest 20% of pixels rather than the whole
frame, since a car filling the frame drags a grey-world average toward its own
paint. Then per-channel levels off the 0.5/99.5 percentiles, a gentle S-curve,
and a small saturation and sharpness lift.

Restrained on purpose. The goal is a set that looks like one body of work, not
a filter.
