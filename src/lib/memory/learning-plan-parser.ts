import { LearningPlan } from '@/types';
import { KNOWLEDGE_TOPICS } from '@/lib/knowledge/topics';

// ============================================================
// Learning Plan Parser
// Parses LLM-generated Markdown learning plans into structured
// LearningPlan objects for persistence and progress tracking.
// ============================================================

/**
 * Map goal string to targetGroup enum.
 */
function mapTargetGroup(goal: string): LearningPlan['targetGroup'] {
  const lower = goal.toLowerCase();
  if (lower.includes('面试') || lower.includes('interview')) return 'interview';
  if (lower.includes('竞赛') || lower.includes('competition') || lower.includes('oi')) return 'competition';
  if (lower.includes('课程') || lower.includes('course') || lower.includes('student')) return 'student';
  return 'self_learner';
}

/**
 * Match a knowledge topic name to its ID using fuzzy matching.
 * Returns the topic ID if found, otherwise returns the raw name.
 */
function matchTopicId(name: string): string {
  const trimmed = name.trim().replace(/\*+/g, '').trim();

  // Exact match
  const exact = KNOWLEDGE_TOPICS.find(t => t.name === trimmed || t.id === trimmed);
  if (exact) return exact.id;

  // Fuzzy match: check if the name contains or is contained in a topic name
  const fuzzy = KNOWLEDGE_TOPICS.find(t =>
    trimmed.includes(t.name) || t.name.includes(trimmed) ||
    trimmed.toLowerCase().includes(t.id) || t.id.includes(trimmed.toLowerCase())
  );
  if (fuzzy) return fuzzy.id;

  return trimmed;
}

/**
 * Parse milestone blocks from the LLM Markdown output.
 * Matches patterns like:
 *   #### 里程碑 1：基础入门（预计 1-2 周）
 *   1. **数组与字符串**（掌握度: 50%）- 说明...
 */
function parseMilestones(markdown: string): LearningPlan['milestones'] {
  const milestones: LearningPlan['milestones'] = [];

  // Match each milestone block: starts with #### or ### followed by "里程碑"
  // Pattern: #### 里程碑 1：基础入门（预计 1-2 周）
  const milestoneRegex = /#{3,4}\s*(?:里程碑\s*)?(\d+)?[：:]\s*([^\n（(]+)(?:[（(]([^)）\n]*)[)）])?\s*\n([\s\S]*?)(?=#{3,4}\s*(?:里程碑|$))/g;

  let match;
  while ((match = milestoneRegex.exec(markdown)) !== null) {
    const title = match[2].trim();
    const estimatedTime = match[3]?.trim() || '';
    const body = match[4].trim();

    // Extract knowledge topic names from numbered list items
    // Patterns: "1. **数组与字符串**（掌握度: 50%）- 说明"
    //       or: "1. 数组与字符串 - 说明"
    const topicRegex = /\d+\.\s*\*{0,2}([^*（(,\-—\n]+?)\*{0,2}\s*(?:[（(]([^)）]*)[)）])?/g;
    const topics: string[] = [];
    let topicMatch;
    while ((topicMatch = topicRegex.exec(body)) !== null) {
      const topicName = topicMatch[1].trim();
      if (topicName && topicName.length > 1 && topicName.length < 30) {
        topics.push(matchTopicId(topicName));
      }
    }

    if (topics.length > 0 || title.length > 0) {
      milestones.push({
        title,
        topics: topics.length > 0 ? topics : [],
        estimatedTime,
        completed: false,
      });
    }
  }

  // Fallback: if no milestones found with the above regex, try simpler pattern
  if (milestones.length === 0) {
    const simpleRegex = /里程碑\s*(\d+)[：:]\s*(.+)/g;
    let simpleMatch;
    while ((simpleMatch = simpleRegex.exec(markdown)) !== null) {
      const title = simpleMatch[2].trim();
      // Look for topic names in the following lines until next milestone
      const startIdx = simpleMatch.index + simpleMatch[0].length;
      const nextMilestoneIdx = markdown.indexOf('里程碑', startIdx);
      const blockEnd = nextMilestoneIdx > 0 ? nextMilestoneIdx : markdown.length;
      const block = markdown.substring(startIdx, blockEnd);

      const topics: string[] = [];
      const lines = block.split('\n');
      for (const line of lines) {
        const lineMatch = line.match(/\d+\.\s*\*{0,2}([^*（(,\-—\n]+?)\*{0,2}/);
        if (lineMatch && lineMatch[1].trim().length > 1) {
          topics.push(matchTopicId(lineMatch[1].trim()));
        }
      }

      milestones.push({
        title,
        topics,
        estimatedTime: '',
        completed: false,
      });
    }
  }

  return milestones;
}

/**
 * Extract the goal from the markdown content.
 */
function extractGoal(markdown: string): string {
  // Look for goal mentions in the content
  const lower = markdown.toLowerCase();
  if (lower.includes('面试') || lower.includes('interview')) return '面试';
  if (lower.includes('竞赛') || lower.includes('competition')) return '竞赛';
  if (lower.includes('课程') || lower.includes('course')) return '课程';
  if (lower.includes('入门') || lower.includes('beginner')) return '入门';
  return '自学';
}

/**
 * Estimate total duration from milestone time estimates.
 */
function extractDuration(markdown: string, milestones: LearningPlan['milestones']): string {
  const times = milestones.map(m => m.estimatedTime).filter(Boolean);
  if (times.length === 0) return '4-8 周';

  // Try to sum up weeks
  const totalWeeks = times.reduce((sum, t) => {
    const weekMatch = t.match(/(\d+)\s*[-~]\s*(\d+)\s*周/);
    if (weekMatch) return sum + parseInt(weekMatch[2]);
    const singleWeek = t.match(/(\d+)\s*周/);
    if (singleWeek) return sum + parseInt(singleWeek[1]);
    return sum;
  }, 0);

  return totalWeeks > 0 ? `${totalWeeks} 周` : '4-8 周';
}

/**
 * Parse LLM Markdown output into a structured LearningPlan.
 * Returns null if parsing fails or no milestones found.
 */
export function parseLearningPlan(markdown: string): LearningPlan | null {
  if (!markdown || markdown.length < 20) return null;

  const milestones = parseMilestones(markdown);
  if (milestones.length === 0) return null;

  const goal = extractGoal(markdown);
  const duration = extractDuration(markdown, milestones);

  return {
    goal,
    targetGroup: mapTargetGroup(goal),
    duration,
    milestones,
    createdAt: Date.now(),
    currentMilestone: 0,
  };
}

/**
 * Update milestone completion status based on current mastery levels.
 * A milestone is considered completed if all its topics have mastery >= 0.7.
 * A milestone is "in progress" if at least one topic has been attempted.
 */
export function updateMilestoneProgress(
  plan: LearningPlan,
  mastery: Record<string, { mastery: number; attempts: number }>
): LearningPlan {
  let currentMilestone = 0;

  const updatedMilestones = plan.milestones.map((milestone, idx) => {
    if (milestone.topics.length === 0) {
      return { ...milestone, completed: false };
    }

    const topicMasteries = milestone.topics.map(topicId => {
      // Try to match by ID or name
      const entry = mastery[topicId];
      if (entry) return entry.mastery;
      // Try fuzzy match
      const fuzzyKey = Object.keys(mastery).find(k =>
        k.includes(topicId) || topicId.includes(k)
      );
      return fuzzyKey ? mastery[fuzzyKey].mastery : 0;
    });

    const allMastered = topicMasteries.every(m => m >= 0.7);
    const anyAttempted = topicMasteries.some((m, i) => {
      const topicId = milestone.topics[i];
      const entry = mastery[topicId];
      return entry && entry.attempts > 0;
    });

    if (allMastered && !currentMilestone) {
      currentMilestone = idx + 1;
    } else if (!allMastered && anyAttempted && currentMilestone <= idx) {
      currentMilestone = idx;
    }

    return { ...milestone, completed: allMastered };
  });

  return {
    ...plan,
    milestones: updatedMilestones,
    currentMilestone: Math.min(currentMilestone, updatedMilestones.length - 1),
  };
}

/**
 * Get a summary of learning plan progress for display.
 */
export function getPlanProgress(plan: LearningPlan): {
  totalMilestones: number;
  completedMilestones: number;
  totalTopics: number;
  masteredTopics: number;
  progressPercent: number;
} {
  const totalMilestones = plan.milestones.length;
  const completedMilestones = plan.milestones.filter(m => m.completed).length;
  const totalTopics = plan.milestones.reduce((sum, m) => sum + m.topics.length, 0);
  const masteredTopics = plan.milestones.reduce((sum, m) => {
    if (m.completed) return sum + m.topics.length;
    return sum;
  }, 0);

  const progressPercent = totalMilestones > 0
    ? Math.round((completedMilestones / totalMilestones) * 100)
    : 0;

  return { totalMilestones, completedMilestones, totalTopics, masteredTopics, progressPercent };
}
