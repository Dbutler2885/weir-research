"""Preserve a PDF and produce local, traceable Docling derivatives."""

import argparse
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent


def write_manifest(directory, manifest):
    temporary = directory / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(directory / "manifest.json")


def convert(
    source,
    pages=None,
    device="auto",
    ocr="auto",
    ocr_engine="auto",
    output_root=None,
    low_memory=False,
):
    source = Path(source).resolve(strict=True)
    if not source.is_file():
        raise ValueError("Input must be a local PDF file.")
    with source.open("rb") as stream:
        if b"%PDF-" not in stream.read(1024):
            raise ValueError("Input does not have a PDF header.")
    if pages and (pages[0] < 1 or pages[1] < pages[0]):
        raise ValueError("Page range must be positive and ordered, for example --pages 1 10.")
    if ocr_engine == "apple" and sys.platform != "darwin":
        raise ValueError("Apple OCR requires macOS. Use --ocr-engine rapidocr or auto.")

    # Copy first: all processing and hashing refer to this immutable capture.
    output_root = (
        Path(output_root).resolve()
        if output_root
        else ROOT / ".research" / "sources"
    )
    output_root.mkdir(parents=True, exist_ok=True)
    directory = output_root / str(uuid.uuid4())
    directory.mkdir(parents=True)
    original = directory / "original.pdf"
    shutil.copyfile(source, original)
    with original.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest = {
        "version": 1,
        "id": directory.name,
        "status": "processing",
        "originalName": source.name,
        "sha256": digest,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "original": "original.pdf",
        "processor": {"name": "docling", "version": version("docling")},
        "settings": {"ocr": ocr, "requestedDevice": device, "pageRange": pages},
        "requestedSubset": pages is not None,
    }
    write_manifest(directory, manifest)
    try:
        from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
        from docling.datamodel.base_models import InputFormat, ConversionStatus
        from docling.datamodel.pipeline_options import PdfPipelineOptions, OcrMacOptions, RapidOcrOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling_core.types.doc import ImageRefMode

        options = PdfPipelineOptions()
        options.do_ocr = ocr != "off"
        options.generate_picture_images = not low_memory
        options.generate_page_images = False
        if low_memory:
            options.ocr_batch_size = 1
            options.layout_batch_size = 1
            options.table_batch_size = 1
        options.accelerator_options = AcceleratorOptions(
            device=AcceleratorDevice(device), num_threads=2
        )
        selected_engine = "rapidocr" if ocr_engine == "auto" else ocr_engine
        if selected_engine == "apple":
            options.ocr_options = OcrMacOptions()
        else:
            options.ocr_options = RapidOcrOptions(backend="onnxruntime", lang=["en"])
        manifest["settings"]["ocrEngine"] = options.ocr_options.kind if options.do_ocr else None
        write_manifest(directory, manifest)
        converter = DocumentConverter(format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options)
        })
        kwargs = {"page_range": tuple(pages)} if pages else {}
        result = converter.convert(original, raises_on_error=False, **kwargs)
        manifest["conversionStatus"] = result.status.value
        manifest["errors"] = [str(error) for error in result.errors]
        if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
            raise RuntimeError(f"Docling conversion failed: {manifest['errors']}")

        result.document.save_as_json(directory / "document.json", image_mode=ImageRefMode.REFERENCED)
        result.document.save_as_markdown(directory / "document.md", image_mode=ImageRefMode.REFERENCED)
        manifest.update({
            "status": "done" if result.status == ConversionStatus.SUCCESS else "partial",
            "totalPages": result.input.page_count,
            "processedPages": sorted(result.document.pages.keys()),
            "structuredDocument": "document.json",
            "markdown": "document.md",
            "completedAt": datetime.now(timezone.utc).isoformat(),
        })
        write_manifest(directory, manifest)
        return {"directory": str(directory), **manifest}
    except BaseException as error:
        manifest.update({"status": "error", "error": str(error) or type(error).__name__})
        write_manifest(directory, manifest)
        raise RuntimeError(f"{error}\nOriginal and failure record preserved in {directory}") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Local PDF file; original is copied into .research/sources")
    parser.add_argument("--pages", nargs=2, type=int, metavar=("FIRST", "LAST"),
                        help="Optional inclusive PDF page range (not printed page labels)")
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    parser.add_argument("--ocr", choices=("auto", "off"), default="auto",
                        help="Use OCR where Docling detects bitmap text, or disable it (Question Wheel behavior)")
    parser.add_argument("--ocr-engine", choices=("auto", "apple", "rapidocr"), default="auto",
                        help="Default: RapidOCR; Apple Vision is available explicitly on macOS")
    parser.add_argument("--output-root",
                        help="Directory for the preserved conversion bundle")
    parser.add_argument("--low-memory", action="store_true",
                        help="Process one page at a time and omit extracted picture images")
    args = parser.parse_args()
    try:
        result = convert(
            args.input,
            args.pages,
            args.device,
            args.ocr,
            args.ocr_engine,
            args.output_root,
            args.low_memory,
        )
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "done" else 2
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
