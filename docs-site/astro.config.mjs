import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://mabulu-inc.github.io',
  base: '/ralph',
  integrations: [
    starlight({
      title: 'Ralph',
      tagline: 'Stateless, PRD-driven AI development',
      favicon: '/favicon.svg',
      logo: {
        src: './public/favicon.svg',
        alt: 'Ralph logo',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/mabulu-inc/simplicity-ralph',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Configuration', slug: 'getting-started/configuration' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Methodology', slug: 'core-concepts/methodology' },
            { label: 'Tasks', slug: 'core-concepts/tasks' },
            { label: 'PRD', slug: 'core-concepts/prd' },
            { label: 'Prompts', slug: 'core-concepts/prompts' },
          ],
        },
        {
          label: 'Commands',
          items: [
            { label: 'init', slug: 'commands/init' },
            { label: 'loop', slug: 'commands/loop' },
            { label: 'monitor', slug: 'commands/monitor' },
            { label: 'kill', slug: 'commands/kill' },
            { label: 'milestones', slug: 'commands/milestones' },
            { label: 'shas', slug: 'commands/shas' },
            { label: 'cost', slug: 'commands/cost' },
            { label: 'update', slug: 'commands/update' },
          ],
        },
        {
          label: 'Agents',
          items: [
            { label: 'Overview', slug: 'agents/overview' },
            { label: 'Claude Code', slug: 'agents/claude' },
            { label: 'Gemini CLI', slug: 'agents/gemini' },
            { label: 'Codex CLI', slug: 'agents/codex' },
            { label: 'Continue', slug: 'agents/continue' },
            { label: 'Cursor', slug: 'agents/cursor' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Writing Tasks', slug: 'guides/writing-tasks' },
            { label: 'Customizing Prompts', slug: 'guides/customizing-prompts' },
          ],
        },
      ],
    }),
  ],
});
