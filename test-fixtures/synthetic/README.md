# Portable synthetic import fixtures

These files are generated test data. They contain no rows copied from CFPS,
CGSS, or another real survey, and tests must not describe them as real survey
data.

## `stata-import.synthetic.dta`

Generated with pandas 2.2.3 using `DataFrame.to_stata(..., version=118,
write_index=False)`. It has three observations and these columns:

| countyid | provname | income |
| ---: | --- | ---: |
| 110101 | North Province | 12.5 |
| 120102 | Central Province | 18.0 |
| 310104 | South Province | 22.75 |

Variable labels are `Synthetic county code`, `Synthetic province name`, and
`Synthetic income`.

## `excel-codebook.synthetic.xls`

Generated with the project's `xlsx` package by writing a one-sheet workbook
with `bookType: "biff8"`. The `Synthetic codebook` sheet has columns
`indicator`, `label`, and `value`, with rows `access / Access score / 1`,
`income / Income score / 2`, and `health / Health score / 3`.

The tests read these named paths relative to `src/lib/io.test.ts`, so they work
from any checkout location without external datasets.
