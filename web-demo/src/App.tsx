import { useState, useEffect, useCallback, useRef, type FC } from 'react';

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
      content: `import React from 'react';\nimport { styled } from '../styles';\nimport { useApi } from '../hooks/useApi';\n\ninterface ButtonProps {\n  onClick?: () => void;\n  children: React.ReactNode;\n  variant?: 'primary' | 'secondary';\n}\n\nexport const Button: React.FC<ButtonProps> = ({ onClick, children, variant = 'primary' }) => {\n  const { isLoading } = useApi();\n  \n  return (\n    <StyledButton \n      onClick={onClick} \n      disabled={isLoading}\n      className={\`btn btn-\${variant}\`}\n    >\n      {children}\n    </StyledButton>\n  );\n};\n\nconst StyledButton = styled.button\`\n  padding: 0.5rem 1rem;\n  border-radius: 4px;\n  border: none;\n  cursor: pointer;\n  \n  &.btn-primary {\n    background-color: #007bff;\n    color: white;\n  }\n  \n  &.btn-secondary {\n    background-color: #6c757d;\n    color: white;\n  }\n  \n  &:disabled {\n    opacity: 0.6;\n    cursor: not-allowed;\n  }\n\`;`,
    },
    {
      path: 'src/styles.ts',
      content: `import styled from 'styled-components';\n\nexport { styled };\n\nexport const theme = {\n  colors: {\n    primary: '#007bff',\n    secondary: '#6c757d',\n    success: '#28a745',\n    danger: '#dc3545',\n    warning: '#ffc107',\n    info: '#17a2b8',\n  },\n  spacing: {\n    xs: '0.25rem',\n    sm: '0.5rem',\n    md: '1rem',\n    lg: '1.5rem',\n    xl: '2rem',\n  },\n  breakpoints: {\n    sm: '576px',\n    md: '768px',\n    lg: '992px',\n    xl: '1200px',\n  },\n};\n\nexport type Theme = typeof theme;`,
    },
    {
      path: 'src/api/client.ts',
      content: `export interface ApiResponse<T> {\n  data: T;\n  status: number;\n  message?: string;\n}\n\nexport interface User {\n  id: number;\n  name: string;\n  email: string;\n  role: 'admin' | 'user';\n}\n\nexport class ApiClient {\n  private baseUrl: string;\n  private token?: string;\n\n  constructor(baseUrl: string = '/api') {\n    this.baseUrl = baseUrl;\n  }\n\n  setToken(token: string): void {\n    this.token = token;\n  }\n\n  private async request<T>(\n    endpoint: string,\n    options: RequestInit = {}\n  ): Promise<ApiResponse<T>> {\n    const url = \`\${this.baseUrl}\${endpoint}\`;\n    const headers = {\n      'Content-Type': 'application/json',\n      ...(this.token && { Authorization: \`Bearer \${this.token}\` }),\n      ...options.headers,\n    };\n\n    const response = await fetch(url, {\n      ...options,\n      headers,\n    });\n\n    const data = await response.json();\n    \n    return {\n      data,\n      status: response.status,\n      message: data.message,\n    };\n  }\n\n  async getUsers(): Promise<ApiResponse<User[]>> {\n    return this.request<User[]>('/users');\n  }\n\n  async getUser(id: number): Promise<ApiResponse<User>> {\n    return this.request<User>(\`/users/\${id}\`);\n  }\n\n  async createUser(user: Omit<User, 'id'>): Promise<ApiResponse<User>> {\n    return this.request<User>('/users', {\n      method: 'POST',\n      body: JSON.stringify(user),\n    });\n  }\n\n  async updateUser(id: number, user: Partial<User>): Promise<ApiResponse<User>> {\n    return this.request<User>(\`/users/\${id}\`, {\n      method: 'PUT',\n      body: JSON.stringify(user),\n    });\n  }\n\n  async deleteUser(id: number): Promise<ApiResponse<void>> {\n    return this.request<void>(\`/users/\${id}\`, {\n      method: 'DELETE',\n    });\n  }\n}`
    },
    {
      path: 'src/hooks/useApi.ts',
      content: `import { useState, useEffect, useCallback } from 'react';\nimport { ApiClient } from '../api/client';\n\nconst apiClient = new ApiClient();\n\nexport interface UseApiState<T> {\n  data: T | null;\n  isLoading: boolean;\n  error: string | null;\n}\n\nexport function useApi<T>() {\n  const [state, setState] = useState<UseApiState<T>>({\n    data: null,\n    isLoading: false,\n    error: null,\n  });\n\n  const execute = useCallback(async (apiCall: () => Promise<T>) => {\n    setState(prev => ({ ...prev, isLoading: true, error: null }));\n    \n    try {\n      const result = await apiCall();\n      setState({ data: result, isLoading: false, error: null });\n      return result;\n    } catch (error) {\n      const errorMessage = error instanceof Error ? error.message : 'An error occurred';\n      setState({ data: null, isLoading: false, error: errorMessage });\n      throw error;\n    }\n  }, []);\n\n  return {\n    ...state,\n    execute,\n    client: apiClient,\n  };\n}`
    },
    {
      path: 'src/components/UserList.tsx',
      content: `import React, { useEffect } from 'react';\nimport { Button } from './Button';\nimport { useApi } from '../hooks/useApi';\nimport type { User } from '../api/client';\n\ninterface UserListProps {\n  onUserSelect?: (user: User) => void;\n}\n\nexport const UserList: React.FC<UserListProps> = ({ onUserSelect }) => {\n  const { data: users, isLoading, error, execute, client } = useApi<User[]>();\n\n  useEffect(() => {\n    loadUsers();\n  }, []);\n\n  const loadUsers = async () => {\n    try {\n      const response = await execute(() => client.getUsers());\n      return response.data;\n    } catch (error) {\n      console.error('Failed to load users:', error);\n    }\n  };\n\n  const handleDeleteUser = async (userId: number) => {\n    if (!confirm('Are you sure you want to delete this user?')) return;\n    \n    try {\n      await execute(() => client.deleteUser(userId));\n      await loadUsers(); // Refresh the list\n    } catch (error) {\n      console.error('Failed to delete user:', error);\n    }\n  };\n\n  if (isLoading) {\n    return <div className=\"loading\">Loading users...</div>;\n  }\n\n  if (error) {\n    return (\n      <div className=\"error\">\n        <p>Error: {error}</p>\n        <Button onClick={loadUsers}>Retry</Button>\n      </div>\n    );\n  }\n\n  return (\n    <div className=\"user-list\">\n      <div className=\"user-list-header\">\n        <h2>Users</h2>\n        <Button onClick={loadUsers}>Refresh</Button>\n      </div>\n      \n      {users && users.length > 0 ? (\n        <ul className=\"users\">\n          {users.map(user => (\n            <li key={user.id} className=\"user-item\">\n              <div className=\"user-info\">\n                <h3>{user.name}</h3>\n                <p>{user.email}</p>\n                <span className={\`role role-\${user.role}\`}>{user.role}</span>\n              </div>\n              <div className=\"user-actions\">\n                <Button \n                  variant=\"secondary\" \n                  onClick={() => onUserSelect?.(user)}\n                >\n                  Edit\n                </Button>\n                <Button \n                  variant=\"secondary\" \n                  onClick={() => handleDeleteUser(user.id)}\n                >\n                  Delete\n                </Button>\n              </div>\n            </li>\n          ))}\n        </ul>\n      ) : (\n        <p>No users found.</p>\n      )}\n    </div>\n  );\n};`
    },
    {
      path: 'src/App.tsx',
      content: `import React, { useState } from 'react';\nimport { Button } from './components/Button';\nimport { UserList } from './components/UserList';\nimport type { User } from './api/client';\nimport './App.css';\n\nexport const App: React.FC = () => {\n  const [selectedUser, setSelectedUser] = useState<User | null>(null);\n  const [showUserList, setShowUserList] = useState(true);\n\n  const handleUserSelect = (user: User) => {\n    setSelectedUser(user);\n    setShowUserList(false);\n  };\n\n  const handleBackToList = () => {\n    setSelectedUser(null);\n    setShowUserList(true);\n  };\n\n  return (\n    <div className=\"app\">\n      <header className=\"app-header\">\n        <h1>User Management System</h1>\n        <nav>\n          <Button \n            variant={showUserList ? 'primary' : 'secondary'}\n            onClick={() => setShowUserList(true)}\n          >\n            Users\n          </Button>\n          <Button \n            variant={!showUserList ? 'primary' : 'secondary'}\n            onClick={() => setShowUserList(false)}\n          >\n            Settings\n          </Button>\n        </nav>\n      </header>\n\n      <main className=\"app-main\">\n        {showUserList ? (\n          <UserList onUserSelect={handleUserSelect} />\n        ) : (\n          <div className=\"settings\">\n            <h2>Settings</h2>\n            <p>Settings panel coming soon...</p>\n            <Button onClick={handleBackToList}>Back to Users</Button>\n          </div>\n        )}\n      </main>\n\n      <footer className=\"app-footer\">\n        <p>&copy; 2024 User Management System</p>\n      </footer>\n    </div>\n  );\n};`
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

type PerformanceMetrics = {
  startTime: number;
  endTime: number;
  duration: number;
  filesProcessed: number;
  nodesFound: number;
  edgesFound: number;
  maxWorkers: number;
  workerMode: 'sequential' | 'worker' | 'web-worker';
}

type WorkerConfig = {
  maxWorkers: number;
  stressTestEnabled: boolean;
  stressTestMultiplier: number;
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
  const [workerConfig, setWorkerConfig] = useState<WorkerConfig>({
    maxWorkers: 1,
    stressTestEnabled: false,
    stressTestMultiplier: 1,
  });
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<PerformanceMetrics | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
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
    // Cancel any ongoing analysis
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    setIsAnalyzing(true);
    setOutput('');
    setLogs([]);
    
    const startTime = performance.now();
    console.info('Starting analysis...', { workerConfig });

    try {
      let files: FileContent[] = JSON.parse(input);
      if (!Array.isArray(files) || !files.every(f => f.path && typeof f.content === 'string')) {
          throw new Error('Invalid input format. Must be an array of {path: string, content: string}');
      }

      // Apply stress test multiplier if enabled
      if (workerConfig.stressTestEnabled && workerConfig.stressTestMultiplier > 1) {
        const originalFiles = [...files];
        files = [];
        for (let i = 0; i < workerConfig.stressTestMultiplier; i++) {
          const multipliedFiles = originalFiles.map(f => ({
            ...f,
            path: `stress-${i}/${f.path}`,
          }));
          files.push(...multipliedFiles);
        }
        console.info(`Stress test enabled: multiplied ${originalFiles.length} files by ${workerConfig.stressTestMultiplier} = ${files.length} total files`);
      }
      
      if (signal.aborted) throw new Error('Analysis cancelled');
      
      console.info('Initializing parser...');
      await initializeParser({ wasmBaseUrl: '/wasm/' });
      console.info('Parser initialized.');

      if (signal.aborted) throw new Error('Analysis cancelled');

      const maxWorkers = workerConfig.maxWorkers;
      const workerMode = maxWorkers > 1 ? 'worker' : 'sequential';

      console.info(`Analyzing ${files.length} files with ${maxWorkers} workers (mode: ${workerMode})...`);
      
      const analysisStartTime = performance.now();
      const rankedGraph = await analyzeProject({
        files,
        rankingStrategy: 'pagerank',
        maxWorkers,
      });
      const analysisEndTime = performance.now();
      
      if (signal.aborted) throw new Error('Analysis cancelled');
      
      console.info(`Analysis complete. Found ${rankedGraph.nodes.size} nodes, ${rankedGraph.edges.length} edges.`);

      console.info('Rendering output...');
      const renderer = createMarkdownRenderer();
      const markdown = renderer(rankedGraph, {
        includeMermaidGraph: true,
      });
      setOutput(markdown);
      console.info('Render complete.');

      const endTime = performance.now();
      const metrics: PerformanceMetrics = {
        startTime,
        endTime,
        duration: endTime - startTime,
        filesProcessed: files.length,
        nodesFound: rankedGraph.nodes.size,
        edgesFound: rankedGraph.edges.length,
        maxWorkers,
        workerMode,
      };
      
      setCurrentMetrics(metrics);
      setPerformanceMetrics(prev => [...prev, metrics]);
      
      console.info('Performance metrics:', {
        totalDuration: `${metrics.duration.toFixed(2)}ms`,
        analysisDuration: `${(analysisEndTime - analysisStartTime).toFixed(2)}ms`,
        filesPerSecond: (files.length / (metrics.duration / 1000)).toFixed(2),
        nodesPerSecond: (rankedGraph.nodes.size / (metrics.duration / 1000)).toFixed(2),
      });

    } catch (e: any) {
      if (e.message === 'Analysis cancelled') {
        console.warn('Analysis was cancelled');
        setOutput(`# Analysis Cancelled\n\nThe analysis was cancelled by the user.`);
      } else {
        console.error('Analysis failed:', e.message, e);
        setOutput(`# Analysis Failed\n\n**Error:**\n\`\`\`\n${e.stack || e.message}\n\`\`\``);
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  }, [input, workerConfig]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleClearMetrics = useCallback(() => {
    setPerformanceMetrics([]);
    setCurrentMetrics(null);
  }, []);

  const handleRunBenchmark = useCallback(async () => {
    const workerCounts = [1, 2, 4, 8];
    const originalConfig = { ...workerConfig };

    for (const maxWorkers of workerCounts) {
      if (abortControllerRef.current?.signal.aborted) break;
      
      setWorkerConfig(prev => ({ ...prev, maxWorkers }));
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      await handleAnalyze();
      await new Promise(resolve => setTimeout(resolve, 500)); // Pause between runs
    }
    
    // Restore original config
    setWorkerConfig(originalConfig);
  }, [workerConfig, handleAnalyze]);

  return (
    <>
      <h1>RepoGraph Web Demo - Worker Battle Test</h1>
      <div className="main-container">
        <div className="config-panel">
          <h3>RepoGraph Worker Battle Test Configuration</h3>
          <div className="config-grid">
            <label className="config-item">
              Max Workers:
              <input
                type="number"
                min="1"
                max="8"
                value={workerConfig.maxWorkers}
                onChange={e => setWorkerConfig(prev => ({ ...prev, maxWorkers: parseInt(e.target.value) || 1 }))}
                title="Number of worker threads for parallel analysis (1 = sequential)"
              />
            </label>
            
            <label className="config-item">
              <input
                type="checkbox"
                checked={workerConfig.stressTestEnabled}
                onChange={e => setWorkerConfig(prev => ({ ...prev, stressTestEnabled: e.target.checked }))}
              />
              Stress Test Mode
            </label>
            
            <label className="config-item">
              File Multiplier:
              <input
                type="number"
                min="1"
                max="20"
                value={workerConfig.stressTestMultiplier}
                onChange={e => setWorkerConfig(prev => ({ ...prev, stressTestMultiplier: parseInt(e.target.value) || 1 }))}
                disabled={!workerConfig.stressTestEnabled}
                title="Multiply input files by this factor for stress testing"
              />
            </label>
            
            <div className="config-info">
              <strong>Current Mode:</strong> {workerConfig.maxWorkers > 1 ? `Parallel (${workerConfig.maxWorkers} workers)` : 'Sequential'}
              {workerConfig.stressTestEnabled && (
                <span> | Stress Test: {workerConfig.stressTestMultiplier}x files</span>
              )}
            </div>
          </div>
          
          <div className="action-buttons">
            <button onClick={handleAnalyze} disabled={isAnalyzing} className="primary-button">
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </button>
            <button onClick={handleCancel} disabled={!isAnalyzing} className="secondary-button">
              Cancel
            </button>
            <button onClick={handleRunBenchmark} disabled={isAnalyzing} className="secondary-button">
              Run Worker Benchmark (1,2,4,8 workers)
            </button>
            <button onClick={handleClearMetrics} className="secondary-button">
              Clear Metrics
            </button>
          </div>
          
          {currentMetrics && (
            <div className="current-metrics">
              <h4>Last Run Metrics</h4>
              <div className="metrics-grid">
                <span>Duration: {currentMetrics.duration.toFixed(2)}ms</span>
                <span>Files: {currentMetrics.filesProcessed}</span>
                <span>Nodes: {currentMetrics.nodesFound}</span>
                <span>Edges: {currentMetrics.edgesFound}</span>
                <span>Workers: {currentMetrics.maxWorkers}</span>
                <span>Mode: {currentMetrics.workerMode}</span>
                <span>Files/sec: {(currentMetrics.filesProcessed / (currentMetrics.duration / 1000)).toFixed(2)}</span>
                <span>Nodes/sec: {(currentMetrics.nodesFound / (currentMetrics.duration / 1000)).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="container">
          <div className="panel">
              <h3>Input Files (JSON format)</h3>
              <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Enter FileContent[] as JSON string..."
                  spellCheck="false"
              />
          </div>
          <div className="panel">
              <h3>Output Markdown</h3>
              <div className="output-panel">
                  <MarkdownRenderer>{output}</MarkdownRenderer>
              </div>
          </div>
        </div>
        
        <div className="bottom-panels">
          <div className="panel">
            <h3>Performance History</h3>
            <div className="metrics-history">
              {performanceMetrics.length === 0 ? (
                <p>No metrics yet. Run an analysis to see performance data.</p>
              ) : (
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Mode</th>
                      <th>Workers</th>
                      <th>Files</th>
                      <th>Duration (ms)</th>
                      <th>Nodes</th>
                      <th>Files/sec</th>
                      <th>Nodes/sec</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceMetrics.map((metric, i) => (
                      <tr key={i} className={i === performanceMetrics.length - 1 ? 'latest' : ''}>
                        <td>{i + 1}</td>
                        <td>{metric.workerMode}</td>
                        <td>{metric.maxWorkers}</td>
                        <td>{metric.filesProcessed}</td>
                        <td>{metric.duration.toFixed(2)}</td>
                        <td>{metric.nodesFound}</td>
                        <td>{(metric.filesProcessed / (metric.duration / 1000)).toFixed(2)}</td>
                        <td>{(metric.nodesFound / (metric.duration / 1000)).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          
          <div className="panel">
              <h3>Logs</h3>
              <div className="logs-panel">
                  {logs.map((log, i) => (
                      <div key={i} className={`log-entry log-${log.level}`}>
                          <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          <span className="log-level">[{log.level.toUpperCase()}]</span>
                          <span className="log-message">{log.args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')}</span>
                      </div>
                  ))}
              </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;