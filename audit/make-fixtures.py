import pathlib
import pandas as pd

out = pathlib.Path(__file__).parent
for version in (117, 118, 119):
    pd.DataFrame({"id": [1, 2, 3], "note": ["</data>", "normal", "plain"], "x": [1., 2., 3.]}).to_stata(
        out / f"tag-in-string-{version}.dta", version=version, write_index=False
    )
pd.DataFrame({"id": [1, 2], "note": ["a" * 2100, "b" * 2100], "x": [1., 2.]}).to_stata(
    out / "strl.dta", version=118, write_index=False
)
