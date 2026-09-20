import { CircleDot, GitBranch, GitMerge, GitPullRequest, Clapperboard } from "lucide-react";
import type { Task } from "@sdlc-ai/shared";

export interface GitHubLinksProps {
  task: Pick<
    Task,
    "issueNumber" | "issueUrl" | "branchName" | "pullRequestNumber" | "pullRequestUrl" | "mergedCommitSha" | "e2eReportCommentUrl" | "e2eReportVideoUrl"
  >;
}

/** Links to the GitHub Issue, branch, and PR as each comes to exist. */
export function GitHubLinks({ task }: GitHubLinksProps) {
  const repoUrl = task.issueUrl?.replace(/\/issues\/\d+$/, "") ?? task.pullRequestUrl?.replace(/\/pull\/\d+$/, "") ?? null;
  const branchUrl = repoUrl && task.branchName ? `${repoUrl}/tree/${task.branchName}` : null;
  const commitUrl = repoUrl && task.mergedCommitSha ? `${repoUrl}/commit/${task.mergedCommitSha}` : null;

  const rows: Array<{ icon: typeof CircleDot; label: string; value: string | null; href: string | null; pending: string }> = [
    { icon: CircleDot, label: "Issue", value: task.issueNumber ? `#${task.issueNumber}` : null, href: task.issueUrl, pending: task.pullRequestNumber ? "PR-adopted" : "Not yet opened" },
    { icon: GitBranch, label: "Branch", value: task.branchName, href: branchUrl, pending: "Created in DEVELOPMENT" },
    { icon: GitPullRequest, label: "Pull request", value: task.pullRequestNumber ? `#${task.pullRequestNumber}` : null, href: task.pullRequestUrl, pending: "Opened by the Developer" },
    { icon: GitMerge, label: "Merged commit", value: task.mergedCommitSha ? task.mergedCommitSha.slice(0, 7) : null, href: commitUrl, pending: "After Approval" },
    {
      icon: Clapperboard,
      label: "E2E report",
      value: task.e2eReportVideoUrl ? "Video" : task.e2eReportCommentUrl ? "PR comment" : null,
      href: task.e2eReportVideoUrl ?? task.e2eReportCommentUrl,
      pending: "Posted after each Test Run",
    },
  ];

  return (
    <dl className="grid min-w-0 grid-cols-1 gap-2.5 text-sm">
      {rows.map(({ icon: Icon, label, value, href, pending }) => (
        <div key={label} className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate font-mono text-xs">
            {value ? (
              href ? (
                <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline" title={value}>
                  {value}
                </a>
              ) : (
                <span title={value}>{value}</span>
              )
            ) : (
              <span className="font-sans text-muted-foreground">{pending}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
