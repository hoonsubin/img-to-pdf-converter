import {
  FileEntry,
  readDir,
  readBinaryFile,
  writeBinaryFile,
} from "@tauri-apps/api/fs";
import { join } from "@tauri-apps/api/path";
import { PDFDocument, PDFImage } from "pdf-lib";
import _ from "lodash";
import JSZip from "jszip";
import { DocumentItem } from "../types";

export const getFileExt = (filePath: string) => {
  const ext = filePath.toLowerCase().split(".").pop();

  if (!ext) {
    throw new Error(`${filePath} does not have an extension`);
  }

  return ext;
};

export const checkFileExtMatch = (filePath: string, ext: string[]) => {
  return ext.includes(getFileExt(filePath));
};

// export const getAllFilesInDir = async (
//   basePath: string,
//   extFilter?: string[]
// ) => {
//   const filesInDir = await readDir(basePath, { recursive: false });

//   if (!filesInDir) {
//     return [];
//   }

//   if (extFilter) {
//     return _.filter(filesInDir, (file) => {
//       return file.name && !file.children && extFilter.includes(file.name!);
//     });
//   }

//   return filesInDir;
// };

export const getAllFolderOrZip = (entry: FileEntry[]) => {
  const foldersOrZip: FileEntry[] = [];

  if (!entry) {
    return [];
  }

  for (let i = 0; i < entry.length; i++) {
    const file = entry[i];
    // skip if it's a special directory (e.g., '.' or '..')
    if (!file.name) {
      continue;
    }

    // if the entry is a subdirectory
    if (file.children) {
      foldersOrZip.push(file);
    } else {
      // only add zip files
      if (checkFileExtMatch(file.path, ["zip"])) {
        foldersOrZip.push(file);
      } else {
        // skip if it's not a sub dir or a zip file
        continue;
      }
    }
  }

  return foldersOrZip;
};

export const readZipFile = async (zipPath: string) => {
  const zipData = await readBinaryFile(zipPath); // todo: needs to be optimized

  return await JSZip.loadAsync(zipData);
};

export const webpToPng = async (webpData: Uint8Array) => {
  // Create an image from the WebP data
  const img = await createImageBitmap(new Blob([webpData])); // todo: can it be optimized?

  // Create a canvas element to draw the image
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Cannot find context 2d in the canvas!");
  }

  ctx.drawImage(img, 0, 0);

  // convert the canvas content to a PNG data URL
  const pngUri = canvas.toDataURL("image/png");

  // note: this might be too much overhead. Need to find a better way in the future
  const pngResponse = await fetch(pngUri);
  const pngBlob = await pngResponse.blob();
  const pngArrayBuffer = await pngBlob.arrayBuffer();

  return new Uint8Array(pngArrayBuffer);
};

const createPdfFromImages = async (imgPagePaths: string[]) => {
  // todo: this function is broken
  const pdfDoc = await PDFDocument.create();

  console.log("Creating a new PDF document");

  for (const imgPath of imgPagePaths) {
    const imgBin = await readBinaryFile(imgPath);
    const imgExt = getFileExt(imgPath);

    console.log(`Processing page ${imgPath}`);

    let imageToAdd: PDFImage;

    switch (imgExt) {
      case "png":
        imageToAdd = await pdfDoc.embedPng(imgBin);
        break;
      case "jpg":
      case "jpeg":
        imageToAdd = await pdfDoc.embedJpg(imgBin);
        break;
      case "webp":
        const pngFromWebp = await webpToPng(imgBin);
        imageToAdd = await pdfDoc.embedPng(pngFromWebp);
        break;
      default:
        throw new Error(`File extension ${imgExt} is not supported`);
    }

    // note: this part will progressively get bigger as the number of processed images increase
    // we need to find a way to process images into chunks, save it before processing the next chunk
    const page = pdfDoc.addPage([imageToAdd.width, imageToAdd.height]);
    page.drawImage(imageToAdd, {
      x: 0,
      y: 0,
      width: imageToAdd.width,
      height: imageToAdd.height,
    });
  }
  return await pdfDoc.save();
};

export const createPdfFromCollection = async (
  doc: DocumentItem,
  outputPath: string
) => {
  if (doc.isArchive) {
    // todo: implement convert zip content to pdf
    console.log(
      `Skipping ${doc.collectionName} as zip support is not added yet`
    );
  } else {
    console.log(
      `Converting collection ${doc.collectionName} in ${doc.basePath}`
    );
    // todo: because we load everything to memory, this function will quickly run out of memory
    const pdfBin = await createPdfFromImages(
      _.map(doc.content, (i) => {
        return i.path;
      })
    );
    const docName = doc.collectionName + ".pdf";
    const savePath = await join(outputPath, docName);
    await writeBinaryFile(savePath, pdfBin);
    console.log(`Saved new PDF ${doc.collectionName} to ${savePath}`);
  }
};
