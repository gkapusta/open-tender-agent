import { RateLimiter, withRetry } from "./retry";
import { UA_DEFAULT } from "./util";
import { fetchWithTimeout } from "./http";
import type { Storage } from "./storage";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface GeocoderOptions {
  callsPerSecond?: number;
  timeoutMs?: number;
}

export class Geocoder {
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;

  constructor(
    private readonly storage: Storage,
    private readonly email?: string,
    options: GeocoderOptions = {}
  ) {
    this.limiter = new RateLimiter(options.callsPerSecond ?? 1);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async geocode(address: string): Promise<[number, number] | null> {
    if (!address?.trim()) {
      return null;
    }

    const normalized = address.trim().toLowerCase();
    const key = `nominatim::${normalized}`;
    const cached = this.storage.geocodeGet(key);
    if (cached && !(cached[0] === 0 && cached[1] === 0)) {
      return cached;
    }

    const result = await this.fetch(address);
    if (!result) {
      return null;
    }

    const lat = Number(result.lat);
    const lon = Number(result.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return null;
    }

    this.storage.geocodePut(key, lat, lon, result);
    return [lat, lon];
  }

  private async fetch(address: string): Promise<{ lat: string; lon: string } | null> {
    return withRetry(async () => {
      await this.limiter.wait();

      const url = new URL(NOMINATIM_URL);
      url.searchParams.set("q", address);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      if (this.email) {
        url.searchParams.set("email", this.email);
      }

      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            "User-Agent": UA_DEFAULT
          }
        },
        this.timeoutMs
      );

      if (!response.ok) {
        throw new Error(`Geocode failed ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as Array<{ lat: string; lon: string }>;
      return data[0] ?? null;
    });
  }

  static haversineKm(a: [number, number], b: [number, number]): number {
    const [lat1, lon1] = a;
    const [lat2, lon2] = b;
    const R = 6371;

    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(x));
  }
}
