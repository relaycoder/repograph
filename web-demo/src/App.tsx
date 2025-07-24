import { useState, useEffect, useCallback, type FC } from 'react';

// Declare global TreeSitterModule for TypeScript
declare global {
  interface Window {
    TreeSitterModule?: {
      locateFile?: (path: string) => string;
    };
  }
}
import {
  initializeParser,
  analyzeProject,
  createMarkdownRenderer,
  logger,
  type FileContent,
  type LogLevel,
} from 'repograph';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

const defaultInput = JSON.stringify(
  [
    {
      path: 'src/components/Button.tsx',
      content: `import { styled } from '../styles';\n\nexport const Button = () => <button>Click me</button>;`,
    },
    {
      path: 'src/styles.ts',
      content: `export function styled(component: any) { return component; }`,
    },
    {
      path: 'src/api/client.ts',
      content: `export class ApiClient {\n  constructor() {}\n  fetchData() { return Promise.resolve(true); }\n}`
    },
     {
      path: 'src/main.ts',
      content: `import { Button } from './components/Button';\nimport { ApiClient } from './api/client';\n\nconst client = new ApiClient();\n\nfunction main() {\n  console.log('App started');\n  client.fetchData();\n}\n\nmain();`
    }
  ],
  null,
  2
);

type LogEntry = {
  level: LogLevel | 'log';
  args: any[];
  timestamp: number;
}

const MarkdownRenderer: FC<{ children: string }> = ({ children }) => {
  return (
    <ReactMarkdown
      children={children}
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? (
            <SyntaxHighlighter
              {...props}
              children={String(children).replace(/\n$/, '')}
              style={vscDarkPlus as any}
              language={match[1]}
              PreTag="div"
            />
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          );
        },
      }}
    />
  );
};


function App() {
  const [input, setInput] = useState(defaultInput);
  const [output, setOutput] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  useEffect(() => {
    logger.setLevel('debug');

    const originalConsole = { ...console };
    const intercept = (level: LogLevel | 'log', ...args: any[]) => {
      (originalConsole as any)[level](...args);
      setLogs(prev => [...prev, { level, args, timestamp: Date.now() }]);
    };

    console.log = (...args) => intercept('log', ...args);
    console.info = (...args) => intercept('info', ...args);
    console.warn = (...args) => intercept('warn', ...args);
    console.error = (...args) => intercept('error', ...args);
    console.debug = (...args) => intercept('debug', ...args);

    return () => {
      Object.assign(console, originalConsole);
    };
  }, []);

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true);
    setOutput('');
    setLogs([]);
    console.info('Starting analysis...');

    try {
      const files: FileContent[] = JSON.parse(input);
      if (!Array.isArray(files) || !files.every(f => f.path && typeof f.content === 'string')) {
          throw new Error('Invalid input format. Must be an array of {path: string, content: string}');
      }
      
      console.info('Initializing parser...');
      await initializeParser({ wasmBaseUrl: '/wasm/' });
      console.info('Parser initialized.');

      console.info(`Analyzing ${files.length} files...`);
      const rankedGraph = await analyzeProject({
        files,
        rankingStrategy: 'pagerank',
        maxWorkers: 1, // Important for browser
      });
      console.info(`Analysis complete. Found ${rankedGraph.nodes.size} nodes.`);

      console.info('Rendering output...');
      const renderer = createMarkdownRenderer();
      const markdown = renderer(rankedGraph, {
        includeMermaidGraph: true,
      });
      setOutput(markdown);
      console.info('Render complete.');

    } catch (e: any) {
      console.error('Analysis failed:', e.message, e);
      setOutput(`# Analysis Failed\n\n**Error:**\n\`\`\`\n${e.stack || e.message}\n\`\`\``);
    } finally {
      setIsAnalyzing(false);
    }
  }, [input]);

  return (
    <>
      <h1>RepoGraph Web Demo</h1>
      <div className="container">
        <div className="panel">
            <h3>Input Files (JSON format)</h3>
            <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Enter FileContent[] as JSON string..."
                spellCheck="false"
            />
            <button onClick={handleAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </button>
        </div>
        <div className="panel">
            <h3>Output Markdown</h3>
            <div className="output-panel">
                <MarkdownRenderer>{output}</MarkdownRenderer>
            </div>
            <h3>Logs</h3>
            <div className="logs-panel">
                {logs.map((log, i) => (
                    <div key={i} className={`log-entry log-${log.level}`}>
                        [{log.level.toUpperCase()}] {log.args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')}
                    </div>
                ))}
            </div>
        </div>
      </div>
    </>
  );
}

export default App;