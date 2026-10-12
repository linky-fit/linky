// Vite emits /assets/index-<hash>.js and /assets/evoluDb.worker-<hash>.js;
// Metro emits /_expo/static/js/web/index-<hash>.js and .../evoluDb-<hash>.js.
export const MAIN_BUNDLE =
  /\/(?:src\/main\.tsx|(?:assets|_expo\/static\/js\/web)\/index-[^/]+\.js)(?:\?.*)?$/;
export const EVOLU_WORKER_BUNDLE = /\/evoluDb(?:\.worker)?-[^/]+\.js$/;
// Also matches the Vite dev server's /src/evoluDb.worker.ts?worker_file.
export const EVOLU_WORKER_REQUEST = /\/evoluDb(?:\.worker)?[-.]/;
