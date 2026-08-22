type ClientCrypto = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>;

export function createClientNonce(cryptoApi: ClientCrypto = globalThis.crypto): string {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
