import { describe, it, expect } from 'bun:test';
import { runRepoGraphForTests } from '../test.util.js';

describe('Multi-Language Support', () => {
  const testCases = [
    {
      language: 'TypeScript',
      extension: 'ts',
      files: {
        'src/calculator.ts': `export class Calculator {
  add(a: number, b: number): number { return a + b; }
  multiply = (a: number, b: number): number => { return a * b; }
}
export interface CalculatorOptions { precision: number; }
export type Operation = 'add' | 'multiply';`
      },
      expectedSymbols: ['Calculator', 'add', 'multiply', 'CalculatorOptions', 'Operation']
    },
    {
      language: 'Python',
      extension: 'py',
      files: {
        'src/math_utils.py': `import math
from typing import List
class MathUtils:
    def calculate_area(self, radius: float) -> float:
        return math.pi * radius ** 2
def factorial(n: int) -> int:
    if n <= 1: return 1
    return n * factorial(n - 1)`
      },
      expectedSymbols: ['MathUtils', 'calculate_area', 'factorial']
    },
    {
      language: 'Java',
      extension: 'java',
      files: {
        'src/StringHelper.java': `package com.example;
public class StringHelper {
    public String concatenate(String a, String b) { return a + b; }
}
interface Formatter { String format(String s); }
enum TextCase { UPPER, LOWER }`
      },
      expectedSymbols: ['StringHelper', 'concatenate', 'Formatter', 'TextCase']
    },
    {
      language: 'Go',
      extension: 'go',
      files: {
        'src/utils.go': `package main
type Point struct { X, Y float64 }
func (p Point) Distance() float64 { return 0.0 }
func Add(a, b int) int { return a + b }`
      },
      expectedSymbols: ['Point', 'Distance', 'Add']
    },
    {
      language: 'Rust',
      extension: 'rs',
      files: {
        'src/lib.rs': `pub struct Point { x: f64, y: f64 }
impl Point { pub fn new(x: f64, y: f64) -> Self { Point { x, y } } }
pub fn calculate_perimeter() -> f64 { 0.0 }`
      },
      expectedSymbols: ['Point', 'new', 'calculate_perimeter']
    },
    {
      language: 'C',
      extension: 'c',
      files: {
        'src/math.c': `#include <stdio.h>
typedef struct { double x; double y; } Point;
enum Color { RED, GREEN, BLUE };
double calculate_distance(Point p1, Point p2) { return 0.0; }`
      },
      expectedSymbols: ['Point', 'Color', 'calculate_distance']
    }
  ];

  it.each(testCases)('should analyze $language files', async ({ files, expectedSymbols, extension }) => {
    const content = await runRepoGraphForTests(files, {
      include: [`**/*.${extension}`]
    });

    for (const symbol of expectedSymbols) {
      expect(content).toContain(symbol);
    }
  });

  it('should analyze multi-language projects', async () => {
    const files = {
      'src/frontend/app.ts': `export class App {}`,
      'src/backend/server.py': `class Server: pass`,
      'src/api/Controller.java': `public class Controller {}`,
      'src/services/auth.go': `package services\nfunc Authenticate(token string) bool { return true }`,
      'src/core/engine.rs': `pub struct Engine {}`
    };

    const content = await runRepoGraphForTests(files);

    expect(content).toContain('App');
    expect(content).toContain('Server');
    expect(content).toContain('Controller');
    expect(content).toContain('Authenticate');
    expect(content).toContain('Engine');
  });

  it('should handle unsupported file types gracefully', async () => {
    const files = {
      'src/code.ts': `export const hello = 'world';`,
      'README.md': '# This is markdown',
      'config.json': '{"key": "value"}'
    };

    const content = await runRepoGraphForTests(files);

    expect(content).toContain('code.ts');
    expect(content).toContain('hello');
    expect(content).toContain('README.md');
    expect(content).toContain('config.json');
    expect(content).not.toContain('key');
  });
});