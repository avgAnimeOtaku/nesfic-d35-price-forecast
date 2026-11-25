# Crop price forecasting for Assam farmers (prototype)

A working prototype for **NESFIC 2026, challenge NESFIC-D-35**: Agricultural Commodity Price Intelligence and Forecasting for Farmer Decisions (Department of Agriculture, Government of Assam).

**Live demo:** https://avgAnimeOtaku.github.io/nesfic-d35-price-forecast/

Pick a crop, an Assam district and a look-ahead of 1, 2 or 4 weeks. The page works out a price forecast in your browser. You can step back to any past week to see what the model said then and what the price did next. It also shows the model's track record for that crop and district, and which months usually bring high and low prices.

Potato is the crop studied in depth. It has a comparison market (Siliguri, West Bengal) and a full Proof of Work. The web app also runs the same method, with no comparison market, on tomato, cabbage, cauliflower, pumpkin, brinjal, onion and green chilli.

- [Proof of Work, potato (web page)](https://avgAnimeOtaku.github.io/nesfic-d35-price-forecast/proof-of-work.html)
- [Proof of Work, potato (PDF)](docs/NESFIC-D-35-Proof-of-Work.pdf)

## What it found for potato

The prototype runs end to end on real public data, and it is reported as it is:

- **Over the last 156 weeks it ties the simplest method and does not beat it.** Across 4 Assam districts and 226 test forecasts, the 1-week error is 6.2%, against 6.1% for assuming the price stays where it is.
- **Over the whole price record it is behind at short range.** Replayed over the full history of 19 districts, one week ahead and over 6,591 forecasts, it misses by 9.1%, against 8.1% for assuming the price stays the same. Four weeks ahead, over 6,269 forecasts, it misses by 18.1% against 17.6%. Four weeks ahead it makes a hold or sell call in 57% of weeks and has the direction right in 60% of those calls.
- **The price record is full of gaps.** In Kamrup district (the Guwahati area), a potato price was reported in only 72% of weeks since 2003. Only 4 of 22 districts had enough recent data to test a forecast at all.
- **The Assam market follows its nearest large market only weakly.** Week-on-week price changes in Kamrup and Siliguri (West Bengal) have a correlation of 0.245.
- **Prices are strongly seasonal.** Over 18 years, Kamrup prices are usually highest in November and lowest in February.

The Proof of Work has the full method, tables, charts and limits.

## Other crops

The same code was run on seven more crops, using each district's own price history and the season, with no comparison market. This is the whole-record test, replayed over every district with 60 or more weeks of prices. `node build-web.js` prints these figures.

| Crop | Districts | Miss 1 week ahead: model / price stays the same | Miss 4 weeks ahead: model / price stays the same |
|---|---|---|---|
| Potato | 19 | 9.1% / 8.1% | 18.1% / 17.6% |
| Onion | 19 | 9.6% / 8.6% | 20.4% / 18.6% |
| Pumpkin | 9 | 11.5% / 10.4% | 17.8% / 16.4% |
| Brinjal | 11 | 15.6% / 14.3% | 27.2% / 26.5% |
| Cabbage | 16 | 16.6% / 15.5% | 32.6% / 37.0% |
| Green chilli | 16 | 17.5% / 15.7% | 30.3% / 30.0% |
| Tomato | 13 | 17.9% / 16.4% | 36.6% / 37.1% |
| Cauliflower | 10 | 22.6% / 22.2% | 45.9% / 61.3% |

- **One week ahead the model is behind the simple method for every crop.**
- **Four weeks ahead it is ahead for cauliflower and cabbage, about level for tomato and green chilli, and behind for the rest.** The two where it helps are the most seasonal.
- **Vegetable prices move far more than potato prices**, so every method misses by more.

What could not be done from public data:

- **Paddy, jute and arecanut.** The bulk copy holds no Assam price records for them dated 2023 or later. The newest official records, from late 2025, hold 46 for paddy, 11 for jute and 1 for arecanut across the whole State. That is too few for a weekly price. Mustard has 303 and was not added.
- **Rice.** Kamrup has no fine-grade rice price from 2020 to late 2025. Then the reported price goes from about Rs 3,300 to Rs 7,500 a quintal within two weeks in February 2026 and stays there. That reads as a change in what is being reported, not a market move, so rice was left out.

For these seven crops the two data sources were compared week by week in Kamrup where they overlap (16 to 18 weeks). Their weekly prices agree for six crops (median ratio 1.00). For green chilli the newest records run about 10% higher, which we have not explained.

## How it works

1. Daily market prices are grouped into one median price per week per district. Records far from the local price level are dropped as unit or typing errors.
2. A forecast starts from the last known local price, if it is at most 4 weeks old. Otherwise the system says "no recent price".
3. A ridge regression adjusts that price using the comparison market's movement and the usual gap between the two markets (potato only), the season and the local trend.
4. The forecast is turned into one of three answers: hold, sell, or no call. The model makes a call only when it expects a move of 5% or more.
5. Every forecast is tested against what actually happened, using only data available at the time, and compared with the simplest method.

## Run it yourself

You need Node.js 20 or later. There are no packages to install.

```
node test.js        # 14 self-checks on the cleaning and forecasting code
node analyze.js     # builds weekly prices, tests against history, writes out/results.json and out/weekly.json
node report.js      # builds the Proof of Work page and the farmer page from out/results.json
node build-web.js   # builds the web app in docs/ and checks every crop, district and look-ahead
```

Then open `docs/index.html` in a browser. It needs no server.

The price records are already in `data/`. To download them again, see the commands at the top of `fetch-hf.js` and `fetch.js`. The newest official records arrive in no date order, so a crop is shown only when its download is complete. The expected counts are in `data/official-totals.json`.

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

History up to April 2026 was taken from a public bulk copy of that resource compiled by Manas Khandelwal (DOI [10.34740/kaggle/dsv/15888319](https://doi.org/10.34740/kaggle/dsv/15888319)). Later records came from the data.gov.in service directly. For potato, a sample of 820 records fetched from the official service was checked against the bulk copy, and 801 matched.

## Rights

Copyright 2026, the project team. All rights reserved. The code is public so that it can be reviewed. It is not open source, and being public does not give anyone a licence to reuse it. The team will give the Department of Agriculture, Government of Assam, a free, non-exclusive licence to use, run and adapt the code for evaluation and the pilot.

The price data is not ours. It stays under the Government Open Data License - India.

## Limits

This is a prototype built for a competition application. Only potato has been studied in depth. The other crops use the same method and have not been reviewed in the same way. It uses public prices only, and has not been used by any farmer or extension worker. It is not advice to act on.
