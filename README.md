# RMD Projector

Single-page calculator that projects required minimum distributions (RMDs) from a traditional IRA or 401(k), including withdrawals taken before RMD age.

- IRS Uniform Lifetime Table (Pub. 590-B, Table III, 2022+) and the Joint and Last Survivor Table for a spouse beneficiary more than 10 years younger
- SECURE 2.0 start ages (72 / 73 / 75 by birth year)
- A one-time withdrawal in a chosen year, a household view for a married couple, and a PDF report
- Planning estimate only; not tax advice.

Open `index.html` in a browser, or visit the GitHub Pages site. The rules the page applies, with sources, are listed on the page.

## Tests

```sh
make test
```

The tests need Node 20 or later and nothing else. They load the calculation code straight out of `index.html` (the block between the `calculation: begin` and `calculation: end` comments), so keep that block free of page access. GitHub Actions runs them on every pull request and on pushes to `main`.

They check the projection against Schwab's RMD calculator (`test/fixtures/schwab.json`, to the cent), the IRS tables, start ages, the one-time withdrawal, household totals, and that the rules version matches the newest changelog entry.

## License

MIT. See [LICENSE](LICENSE).
