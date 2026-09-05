/**
 * ---------------------------------------------------------------------------
 * NIFTI VOXEL TYPING
 * ---------------------------------------------------------------------------
 * The one piece of NIfTI decoding that both halves of the app need: turning the
 * raw image bytes into a typed array of the right element type.
 *
 * It lives here rather than in `image-render.ts` because that module imports
 * `fs` and `pngjs` and can therefore never be pulled into a browser bundle,
 * while the committed `public/demo-data` studies are decoded client-side (see
 * `lib/demo/decode.ts`) — the deployed Cloudflare Worker has no filesystem to
 * render them from. Sharing this function is what keeps the two paths from
 * disagreeing about what a datatype code means.
 *
 * No `fs`, no `path`, no dependencies at all.
 * ---------------------------------------------------------------------------
 */

/** Anything indexable and length-bearing — the several typed arrays below, without a union at every call site. */
export interface VoxelArray {
  [i: number]: number;
  length: number;
  /**
   * Size in bytes. Every value of this type comes from `niftiTypedArray`, so it is
   * always a typed array and this is always present; it is declared because a
   * cache that holds volumes has to be bounded by memory rather than by count, and
   * `length` alone does not say how much a `Float32` volume costs against a
   * `Uint8` one.
   */
  readonly byteLength: number;
}

/**
 * Views the image bytes as the element type the header declares.
 *
 * Codes are the NIFTI1.TYPE_* constants. An unrecognized code falls back to
 * Int16Array, which is the commonest NIfTI element type — the alternative is
 * refusing to display a volume over a header field we do not need to
 * understand fully.
 */
export function niftiTypedArray(datatypeCode: number, buf: ArrayBuffer): VoxelArray {
  switch (datatypeCode) {
    case 2:
      return new Uint8Array(buf);
    case 4:
      return new Int16Array(buf);
    case 8:
      return new Int32Array(buf);
    case 16:
      return new Float32Array(buf);
    case 64:
      return new Float64Array(buf);
    case 256:
      return new Int8Array(buf);
    case 512:
      return new Uint16Array(buf);
    case 768:
      return new Uint32Array(buf);
    default:
      return new Int16Array(buf);
  }
}
