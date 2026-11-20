# Sum up 19 November's world news in one image

[![make.fun](https://make.fun/badge/news-image-20261119.svg)](https://make.fun/bounty/news-image-20261119)
[![rank](https://make.fun/badge/news-image-20261119/apasi22/news-image-20261119/rank.svg)](https://make.fun/bounty/news-image-20261119)
[![reward](https://make.fun/badge/news-image-20261119/apasi22/news-image-20261119/reward.svg)](https://make.fun/bounty/news-image-20261119)

A code-drawn front page summing up Thursday 19 November 2026: 21 verified
stories, a dotted world map with location pins, a two-column brief list, and a
DATE CHECK strip excluding stories from other days.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, stdlib only, no network) draws the page with its own
TrueType parser and rasterizer, using the subset fonts in `fonts/`, and writes
`entry.png` (1024×1024, deterministic).

## Stories

Lead: first-ever Trump–Xi–Putin trilateral in Shenzhen (four-point
declaration, no mention of Ukraine); ICJ rules Myanmar guilty of genocide,
9–6; Houthi missile hits Riyadh's PIF Tower (Reuters/SPA/AFP). Plus the
Anthropic $81.3bn IPO, GTA VI's global launch, Bangladesh, the Kerch Bridge,
COP31, the Hormuz crisis, and eleven more — all dated 19 November 2026.
