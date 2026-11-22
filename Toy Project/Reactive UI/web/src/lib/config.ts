import { useQuery } from "@tanstack/react-query";

import { configApi } from "./api";

/** Runtime settings from the server (map client ID, archive), fetched once per visit. */
export const useConfig = () =>
  useQuery({ queryKey: ["config"], queryFn: configApi.get, staleTime: Infinity });
