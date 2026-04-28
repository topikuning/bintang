import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Category, Company, Page, Project, User, VendorClient } from "@/types";

/**
 * Hook + prefetch helper untuk data referensi yang sering dipakai
 * di banyak halaman (companies, vendors, categories, projects-light, users).
 *
 * Semua endpoint dipanggil dengan size besar (1000) supaya konsisten antar
 * halaman. queryKey-nya tunggal -- jadi cache di-share, dan staleTime
 * default (5 menit) di QueryClient bikin nggak refetch ulang saat pindah
 * halaman.
 */

const REF_SIZE = 1000;

const FETCHERS = {
  companies: async () =>
    (await api.get<Page<Company>>(`/companies?size=${REF_SIZE}`)).data,
  vendorsClients: async () =>
    (await api.get<Page<VendorClient>>(`/vendors-clients?size=${REF_SIZE}`)).data,
  categories: async () =>
    (await api.get<Page<Category>>(`/categories?size=${REF_SIZE}`)).data,
  projectsLight: async () =>
    (await api.get<Page<Project>>(`/projects?size=${REF_SIZE}`)).data,
  users: async () =>
    (await api.get<Page<User>>(`/users?size=${REF_SIZE}`)).data,
} as const;

export const REF_KEYS = {
  companies: ["companies"] as const,
  vendorsClients: ["vendors-clients"] as const,
  categories: ["categories"] as const,
  projectsLight: ["projects-light"] as const,
  users: ["users"] as const,
};

export function useCompanies() {
  return useQuery({ queryKey: REF_KEYS.companies, queryFn: FETCHERS.companies });
}

export function useVendorsClients() {
  return useQuery({
    queryKey: REF_KEYS.vendorsClients,
    queryFn: FETCHERS.vendorsClients,
  });
}

export function useCategories() {
  return useQuery({ queryKey: REF_KEYS.categories, queryFn: FETCHERS.categories });
}

export function useProjectsLight() {
  return useQuery({
    queryKey: REF_KEYS.projectsLight,
    queryFn: FETCHERS.projectsLight,
  });
}

export function useUsers(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REF_KEYS.users,
    queryFn: FETCHERS.users,
    enabled: opts?.enabled,
  });
}

/**
 * Panggil di onSuccess login agar list referensi sudah hangat saat user
 * langsung navigasi.
 */
export async function prefetchReferenceData(qc: QueryClient) {
  await Promise.all([
    qc.prefetchQuery({ queryKey: REF_KEYS.companies, queryFn: FETCHERS.companies }),
    qc.prefetchQuery({
      queryKey: REF_KEYS.vendorsClients,
      queryFn: FETCHERS.vendorsClients,
    }),
    qc.prefetchQuery({ queryKey: REF_KEYS.categories, queryFn: FETCHERS.categories }),
    qc.prefetchQuery({
      queryKey: REF_KEYS.projectsLight,
      queryFn: FETCHERS.projectsLight,
    }),
  ]);
}
