# Haydari books project

The book workflow lives in `books/`.

1. `books/books_inventory.py` — makes the local book database.
2. `books/process_book.py` — temporary page images, body/footnote split, Arabic reading, English draft, and footnote count check.
3. `books/publish_book_to_google.py` — creates the Google Doc and saves its link. The three-book pilot is where we prove real Google Docs footnotes and the native table of contents.
4. `books/sync_archive_data.py` — copies each book's status and Google Doc link into the website data file.
5. `books/run_batch.py` — keeps taking the next ready book, one at a time.

## Before a real run

- Install Poppler (`pdftoppm`), Apple Vision OCR, Tesseract with Arabic data, Pillow, Ollama, Aya Expanse 8B, and the Google API libraries.
- Set up a Google service account and share the target Drive folder with it.
- Use `books/books_inventory.py` first.
- Test exactly three books before using `books/run_batch.py`.

## OCR decision during the three-book test

Test the same mixed sample pages with Apple Vision and Tesseract. Compare Arabic accuracy, footnote-marker accuracy, header/footnote separation, and seconds per page. Use the better result for the full run; do not choose only by speed.

The batch runner is intentionally one book at a time. OCR and translation should not fight for the same GPU/RAM.
