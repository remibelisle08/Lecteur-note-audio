declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  /** Fabrique Emscripten du phonémiseur Piper (espeak-ng). */
  const createPiperPhonemize: (moduleArg: {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (file: string) => string;
  }) => Promise<{ callMain(args: string[]): number }>;
  export default createPiperPhonemize;
}
