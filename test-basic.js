import { generateMap } from './dist/index.js';

// Test basic functionality
console.log('Testing RepoGraph basic functionality...');

try {
  await generateMap({
    root: './src',
    output: './test-output.md',
    include: ['**/*.ts'],
    ignore: ['**/*.test.ts', '**/*.spec.ts']
  });
  console.log('✅ RepoGraph test completed successfully!');
  console.log('📄 Output written to test-output.md');
} catch (error) {
  console.error('❌ RepoGraph test failed:', error.message);
  process.exit(1);
}