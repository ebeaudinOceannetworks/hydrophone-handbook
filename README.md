# Hydrophone Handbook

Internal Ocean Networks Canada guide to the hydrophone network: how the instruments work, how data are processed and accessed, and how the array is operated.

## Read it

After a render, open `_book/index.html`, or run:

```bash
quarto preview
```

## Build

```bash
pip install -r requirements.txt
quarto render
```

Pages that pull live deployment data need an Oceans 3.0 API token in a local `.env` file:

```
ONC_API_TOKEN=your_token
```

Do not commit `.env`.

## Notes

Draft chapters live in `under_construction/` and are not in the table of contents. Calibration is still in progress.
