declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<any>;
}

declare module 'snarkjs' {
  export namespace groth16 {
    function verify(vk: any, publicSignals: any[], proof: any): Promise<boolean>;
    function fullProve(input: any, wasmFile: string, zkeyFile: string): Promise<{ proof: any; publicSignals: string[] }>;
  }
}
