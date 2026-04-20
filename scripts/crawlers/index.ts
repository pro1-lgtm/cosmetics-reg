import type { CrawlerSource } from "./types";
import { usFdaProhibited } from "./fetchers/us-fda";
import { krMfdsSafetyStandards } from "./fetchers/kr-mfds";
import { cnNmpaIecic } from "./fetchers/cn-iecic";
import { euCosing } from "./fetchers/eu-cosing";
import { jpMhlwStandards } from "./fetchers/jp-mhlw";
import { vnDavCirculars } from "./fetchers/vn-dav";
import { thFdaCirculars } from "./fetchers/th-fda";

export const allSources: CrawlerSource[] = [
  krMfdsSafetyStandards,
  cnNmpaIecic,
  euCosing,
  usFdaProhibited,
  jpMhlwStandards,
  vnDavCirculars,
  thFdaCirculars,
];
