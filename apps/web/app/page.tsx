'use client';
import Link from 'next/link';
import { Badge, Button, Group, Text, ThemeIcon, Title } from '@mantine/core';
import {
  IconArrowRight,
  IconCheck,
  IconScan,
  IconShieldLock,
  IconTableExport,
  IconSparkles,
  IconMail,
  IconBuilding,
  IconArrowDown,
} from '@tabler/icons-react';
import { Logo } from '../components/logo';
export default function Landing() {
  return (
    <>
      <header className="public-nav">
        <Logo />
        <Group gap="xl" className="public-actions">
          <Link className="nav-extra" href="#workflow">
            <Text size="sm" c="dimmed">
              How it works
            </Text>
          </Link>
          <Link className="nav-extra" href="#privacy">
            <Text size="sm" c="dimmed">
              Built for privacy
            </Text>
          </Link>
          <Button component={Link} href="/login" variant="subtle" color="gray">
            Sign in
          </Button>
          <Button
            component={Link}
            href="/register"
            className="header-start"
            rightSection={<IconArrowRight size={16} />}
          >
            Get started
          </Button>
        </Group>
      </header>
      <main>
        <section className="hero">
          <div>
            <Badge variant="light" size="lg" radius="sm" leftSection={<IconSparkles size={14} />}>
              Less busywork. More connections.
            </Badge>
            <h1>
              A business card.
              <br />A new connection.
              <br />
              <span style={{ color: 'var(--mantine-primary-color-filled)' }}>All organized.</span>
            </h1>
            <p>
              Turn business cards into contacts you can use. Scan, review, and export from one
              private, thoughtfully organized workspace.
            </p>
            <Group mt={30}>
              <Button
                component={Link}
                href="/register"
                size="md"
                rightSection={<IconArrowRight size={17} />}
              >
                Create your workspace
              </Button>
              <Button component={Link} href="#workflow" size="md" variant="default">
                See how it works
              </Button>
            </Group>
            <Group mt={24} gap="lg">
              <Text size="xs" c="dimmed">
                <IconCheck size={13} style={{ verticalAlign: 'middle' }} /> Review before you save
              </Text>
              <Text size="xs" c="dimmed">
                <IconCheck size={13} style={{ verticalAlign: 'middle' }} /> Private file storage
              </Text>
            </Group>
          </div>
          <div
            className="hero-art hero-grid"
            aria-label="Illustration of a sample business card converted into contact fields"
          >
            <span className="art-label">ILLUSTRATIVE EXAMPLE</span>
            <div className="business-card">
              <Group justify="space-between">
                <Text fw={750} size="sm">
                  NORTHLINE<span style={{ color: 'var(--mantine-primary-color-filled)' }}>®</span>
                </Text>
                <IconScan size={24} color="var(--mantine-primary-color-filled)" />
              </Group>
              <Title order={3} mt={22} style={{ letterSpacing: '-.6px' }}>
                Alex Morgan
              </Title>
              <Text size="xs" c="dimmed" mt={3}>
                Design Director
              </Text>
              <div style={{ height: 1, background: 'var(--ff-border)', margin: '20px 0 12px' }} />
              <Text size="xs" c="dimmed">
                alex@example.com
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                northline.example
              </Text>
            </div>
            <Group justify="center" py={12}>
              <ThemeIcon variant="light" radius="xl">
                <IconArrowDown size={18} />
              </ThemeIcon>
            </Group>
            <div className="art-result">
              <Group justify="space-between" mb={18}>
                <Group gap={8}>
                  <IconSparkles size={17} color="var(--mantine-primary-color-filled)" />
                  <Text size="xs" fw={650}>
                    Ready for your review
                  </Text>
                </Group>
                <Badge size="xs" variant="light" color="teal">
                  Extracted
                </Badge>
              </Group>
              <Group gap={13} mb={12}>
                <ThemeIcon color="gray" variant="light">
                  <IconBuilding size={17} />
                </ThemeIcon>
                <div>
                  <Text size="xs" c="dimmed">
                    Company
                  </Text>
                  <Text size="sm" fw={550}>
                    Northline
                  </Text>
                </div>
              </Group>
              <Group gap={13}>
                <ThemeIcon color="gray" variant="light">
                  <IconMail size={17} />
                </ThemeIcon>
                <div>
                  <Text size="xs" c="dimmed">
                    Email address
                  </Text>
                  <Text size="sm" fw={550}>
                    alex@example.com
                  </Text>
                </div>
              </Group>
            </div>
          </div>
        </section>
        <section id="workflow" className="public-section">
          <div className="public-container">
            <Text className="eyebrow">FROM CARD TO CONTACT</Text>
            <Title order={2} mt={10} style={{ letterSpacing: '-1px' }}>
              A simpler way to keep in touch.
            </Title>
            <div className="feature-grid">
              {[
                {
                  icon: IconScan,
                  title: '01. Capture the details',
                  text: 'Upload the front and back of your business card. AI extracts the details, including multilingual information.',
                },
                {
                  icon: IconCheck,
                  title: '02. Make it yours',
                  text: 'Review the original, correct any details, and approve the contact. You stay in control of what gets saved.',
                },
                {
                  icon: IconTableExport,
                  title: '03. Put contacts to work',
                  text: 'Search and organize your contacts. Export selected contacts to a neatly formatted Excel workbook.',
                },
              ].map((f) => (
                <div key={f.title}>
                  <ThemeIcon size={44} variant="light" radius="md">
                    <f.icon size={24} stroke={1.5} />
                  </ThemeIcon>
                  <Title order={4} mt={18} mb={9}>
                    {f.title}
                  </Title>
                  <Text c="dimmed" size="sm" lh={1.8}>
                    {f.text}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section
          id="privacy"
          className="public-section"
          style={{ background: 'var(--ff-surface)' }}
        >
          <div className="public-container">
            <Group justify="space-between" align="center" gap={30}>
              <div>
                <Group mb={12}>
                  <IconShieldLock size={23} color="var(--mantine-primary-color-filled)" />
                  <Text className="eyebrow">YOUR WORKSPACE, YOUR INFORMATION</Text>
                </Group>
                <Title order={2} style={{ letterSpacing: '-1px' }}>
                  Built around your privacy.
                </Title>
                <Text size="sm" c="dimmed" mt={12} maw={600} lh={1.8}>
                  Private object storage, workspace-level access controls, and short-lived download
                  links. Your files and contacts belong to your workspace.
                </Text>
              </div>
              <Button component={Link} href="/register" rightSection={<IconArrowRight size={16} />}>
                Start with your first card
              </Button>
            </Group>
          </div>
        </section>
      </main>
      <footer className="public-nav">
        <Logo />
        <Group gap="lg">
          <Text size="xs" c="dimmed">
            © {new Date().getFullYear()} FileForge AI
          </Text>
          <Link href="/privacy">
            <Text size="xs" c="dimmed">
              Privacy
            </Text>
          </Link>
          <Link href="/terms">
            <Text size="xs" c="dimmed">
              Terms
            </Text>
          </Link>
        </Group>
      </footer>
    </>
  );
}
