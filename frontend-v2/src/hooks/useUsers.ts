import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Page, User, UserCreateInput, UserUpdateInput } from "@/types/api"

const KEY = ["users"] as const

export function useUsers(params: { page?: number; size?: number; q?: string } = {}) {
  return useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: async (): Promise<Page<User>> => {
      const { data } = await api.get<Page<User>>("/users", {
        params: { page: 1, size: 100, ...params },
      })
      return data
    },
    staleTime: 60_000,
  })
}

export interface UserLookupRow {
  id: number
  name: string
  email: string
}

/** Lookup user minimal info (id/name/email) -- accessible semua role.
 *  Dipakai utk picker di form (mis. penerima dana operasional). */
export function useUsersLookup(params: { q?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: ["users-lookup", params],
    queryFn: async (): Promise<UserLookupRow[]> => {
      const { data } = await api.get<UserLookupRow[]>("/users/lookup", {
        params: { limit: 200, ...params },
      })
      return data
    },
    staleTime: 5 * 60_000,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UserCreateInput): Promise<User> => {
      const { data } = await api.post<User>("/users", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateUser(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UserUpdateInput): Promise<User> => {
      const { data } = await api.patch<User>(`/users/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/users/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useAssignProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, projectId }: { userId: number; projectId: number }) => {
      await api.post(`/users/${userId}/projects/${projectId}`)
    },
    onSuccess: (_, vars) => {
      // useUsers list (project_ids per user berubah) + useProjectUsers
      // list anggota tim per project + useUserProjects list proyek per user.
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ["projects", "users", vars.projectId] })
      qc.invalidateQueries({ queryKey: ["users", "projects", vars.userId] })
    },
  })
}

export function useUnassignProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, projectId }: { userId: number; projectId: number }) => {
      await api.delete(`/users/${userId}/projects/${projectId}`)
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ["projects", "users", vars.projectId] })
      qc.invalidateQueries({ queryKey: ["users", "projects", vars.userId] })
    },
  })
}

export interface UserProject {
  id: number
  code: string
  name: string
  status: string
}

/** List proyek yg ditugaskan ke user (eksplisit lewat project_users). */
export function useUserProjects(userId: number | null | undefined) {
  return useQuery({
    queryKey: ["users", "projects", userId ?? -1],
    queryFn: async (): Promise<UserProject[]> => {
      const { data } = await api.get<UserProject[]>(`/users/${userId}/projects`)
      return data
    },
    enabled: userId != null && userId > 0,
  })
}
