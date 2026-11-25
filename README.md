# Potato price forecasting for Assam farmers (prototype)

A working prototype for **NESFIC 2026, challenge NESFIC-D-35**: Agricultural Commodity Price Intelligence and Forecasting for Farmer Decisions (Department of Agriculture, Government of Assam).

**Live demo:** https://avgAnimeOtaku.github.io/nesfic-d35-price-forecast/

Pick an Assam district and a look-ahead of 1, 2 or 4 weeks. The page works out a price forecast in your browser, shows how the model did when tested against history in that district, and shows which months usually bring high and low prices.

- [Proof of Work (web page)](https://avgAnimeOtaku.github.io/nesfic-d35-price-forecast/proof-of-work.html)
- [Proof of Work (PDF)](docs/NESFIC-D-35-Proof-of-Work.pdf)

## What it found

The prototype runs end to end on real public data, and it is reported as it is:

- **It ties the simplest method and does not yet beat it.** Across 4 Assam districts and 226 test forecasts, the 1-week error is 6.2%, against 6.1% for assuming the price stays where it is.
- **The price record is full of gaps.** In Kamrup district (the Guwahati area), a potato price was reported in only 72% of weeks since 2003. Only 4 of 22 districts had enough recent data to test a forecast at all.
- **The Assam market follows its nearest large market only weakly.** Week-on-week price changes in Kamrup and Siliguri (West Bengal) have a correlation of 0.245.
- **Prices are strongly seasonal.** Over 18 years, Kamrup prices are usually highest in November and lowest in February.

The Proof of Work has the full method, tables, charts and limits.

## How it works

1. Daily market prices are grouped into one median price per week per district. Records far from the local price level are dropped as unit or typing errors.
2. A forecast starts from the last known local price, if it is at most 4 weeks old. Otherwise the system says "no recent price".
3. A ridge regression adjusts that price using the comparison market's movement, the usual gap between the two markets, the season and the local trend.
4. The forecast is turned into one of three answers: hold, sell, or no clear signal.
5. Every forecast is tested against what actually happened, using only data available at the time, and compared with the simplest method.

## Run it yourself

You need Node.js 20 or later. There are no packages to install.

```
node test.js        # 14 self-checks on the cleaning and forecasting code
node analyze.js     # builds weekly prices, tests against history, writes out/results.json
node report.js      # builds the Proof of Work page and the farmer page from out/results.json
node build-web.js   # builds the web app in docs/
```

Then open `docs/index.html` in a browser. It needs no server.

The price records are already in `data/`. To download them again, see the commands at the top of `fetch-hf.js` and `fetch.js`.

## Files

| File | Purpose |
|---|---|
| `fetch.js`, `fetch-hf.js` | Download the price records |
| `series.js` | Cleaning and weekly prices |
| `model.js` | The forecast and the test against history |
| `test.js` | Self-checks |
| `analyze.js` | Runs the whole analysis |
| `report.js` | Builds the Proof of Work and the farmer page |
| `build-web.js` | Bundles the same code for the browser |
| `docs/` | The web app, served by GitHub Pages |

## Data and attribution

Prices come from AGMARKNET, Ministry of Agriculture and Farmers Welfare, Government of India, through data.gov.in ([Variety-wise Daily Market Prices Data of Commodity](https://www.data.gov.in/resource/variety-wise-daily-market-prices-data-commodity)), published under the [Government Open Data License - India](https://www.data.gov.in/Godl).

History up to April 2026 was taken from a public bulk copy of that resource compiled by Manas Khandelwal (DOI [10.34740/kaggle/dsv/15888319](https://doi.org/10.34740/kaggle/dsv/15888319)). Later records came from the data.gov.in service directly. A sample of 820 records fetched from the official service was checked against the bulk copy, and 801 matched.

## Limits

This is a prototype built for a competition application. It covers one crop, uses public prices only, and has not been used by any farmer or extension worker. It is not advice to act on.
