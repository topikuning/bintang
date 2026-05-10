import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface ProjectMember {
  id: number
  email: string
  name: string
  role: string
}

export function useProjectUsers(projectId: number | null | undefined) {
  return useQuery({
    queryKey: ["projects", "users", projectId ?? -1],
    queryFn: async (): Promise<ProjectMember[]> => {
      const { data } = await api.get<ProjectMember[]>(`/projects/${projectId}/users`)
      return data
    },
    enabled: projectId != null && projectId > 0,
  })
}
