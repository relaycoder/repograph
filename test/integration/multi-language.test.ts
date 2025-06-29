import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { generateMap } from '../../src/high-level.js';
import { createTempDir, cleanupTempDir, createTestFiles } from '../test.util.js';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('Multi-Language Support', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should analyze TypeScript files', async () => {
    const files = {
      'src/calculator.ts': `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  
  multiply = (a: number, b: number): number => {
    return a * b;
  }
}

export interface CalculatorOptions {
  precision: number;
}

export type Operation = 'add' | 'multiply';`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'typescript.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.ts']
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('Calculator');
    expect(content).toContain('add');
    expect(content).toContain('multiply');
    expect(content).toContain('CalculatorOptions');
    expect(content).toContain('Operation');
  });

  it('should analyze Python files', async () => {
    const files = {
      'src/math_utils.py': `import math
from typing import List

class MathUtils:
    def __init__(self, precision: int = 2):
        self.precision = precision
    
    def calculate_area(self, radius: float) -> float:
        return math.pi * radius ** 2
    
    @staticmethod
    def sum_list(numbers: List[float]) -> float:
        return sum(numbers)

def factorial(n: int) -> int:
    if n <= 1:
        return 1
    return n * factorial(n - 1)`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'python.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.py']
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('MathUtils');
    expect(content).toContain('calculate_area');
    expect(content).toContain('sum_list');
    expect(content).toContain('factorial');
  });

  it('should analyze Java files', async () => {
    const files = {
      'src/StringHelper.java': `package com.example.utils;

import java.util.List;
import java.util.ArrayList;

public class StringHelper {
    private static final String DEFAULT_SEPARATOR = " ";
    
    public StringHelper() {
        // Default constructor
    }
    
    public String concatenate(String first, String second) {
        return first + DEFAULT_SEPARATOR + second;
    }
    
    public List<String> split(String input, String delimiter) {
        List<String> result = new ArrayList<>();
        // Implementation here
        return result;
    }
}

interface Formatter {
    String format(String input);
}

enum TextCase {
    UPPER, LOWER, TITLE
}`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'java.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.java']
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('StringHelper');
    expect(content).toContain('concatenate');
    expect(content).toContain('split');
    expect(content).toContain('Formatter');
    expect(content).toContain('TextCase');
  });

  it('should analyze Go files', async () => {
    const files = {
      'src/utils.go': `package main

import (
    "fmt"
    "math"
)

type Point struct {
    X, Y float64
}

type Calculator interface {
    Add(a, b float64) float64
    Multiply(a, b float64) float64
}

func (p Point) Distance(other Point) float64 {
    dx := p.X - other.X
    dy := p.Y - other.Y
    return math.Sqrt(dx*dx + dy*dy)
}

func Add(a, b float64) float64 {
    return a + b
}

const Pi = 3.14159

var GlobalCounter int = 0`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'go.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.go']
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('Point');
    expect(content).toContain('Calculator');
    expect(content).toContain('Distance');
    expect(content).toContain('Add');
    expect(content).toContain('Pi');
    expect(content).toContain('GlobalCounter');
  });

  it('should analyze Rust files', async () => {
    const files = {
      'src/lib.rs': `use std::fmt;

pub struct Point {
    pub x: f64,
    pub y: f64,
}

pub enum Shape {
    Circle(f64),
    Rectangle(f64, f64),
    Triangle(Point, Point, Point),
}

pub trait Area {
    fn area(&self) -> f64;
}

impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }
    
    pub fn distance(&self, other: &Point) -> f64 {
        ((other.x - self.x).powi(2) + (other.y - self.y).powi(2)).sqrt()
    }
}

impl Area for Shape {
    fn area(&self) -> f64 {
        match self {
            Shape::Circle(radius) => std::f64::consts::PI * radius * radius,
            Shape::Rectangle(width, height) => width * height,
            Shape::Triangle(_, _, _) => 0.0, // Simplified
        }
    }
}

pub fn calculate_perimeter(shape: &Shape) -> f64 {
    match shape {
        Shape::Circle(radius) => 2.0 * std::f64::consts::PI * radius,
        _ => 0.0, // Simplified
    }
}

pub const MAX_SIZE: f64 = 1000.0;
pub static mut GLOBAL_COUNTER: i32 = 0;`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'rust.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.rs']
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('Point');
    expect(content).toContain('Shape');
    expect(content).toContain('Area');
    expect(content).toContain('new');
    expect(content).toContain('distance');
    expect(content).toContain('area');
    expect(content).toContain('calculate_perimeter');
    expect(content).toContain('MAX_SIZE');
    expect(content).toContain('GLOBAL_COUNTER');
  });

  it('should analyze C files', async () => {
    const files = {
      'src/math.c': `#include <stdio.h>
#include <math.h>

typedef struct {
    double x;
    double y;
} Point;

typedef union {
    int i;
    float f;
    double d;
} Number;

enum Color {
    RED,
    GREEN,
    BLUE
};

double calculate_distance(Point p1, Point p2) {
    double dx = p2.x - p1.x;
    double dy = p2.y - p1.y;
    return sqrt(dx * dx + dy * dy);
}

Point create_point(double x, double y) {
    Point p = {x, y};
    return p;
}

void print_point(Point p) {
    printf("Point: (%.2f, %.2f)\\n", p.x, p.y);
}`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'c.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.c']
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('Point');
    expect(content).toContain('Number');
    expect(content).toContain('Color');
    expect(content).toContain('calculate_distance');
    expect(content).toContain('create_point');
    expect(content).toContain('print_point');
  });

  it('should analyze multi-language projects', async () => {
    const files = {
      // TypeScript
      'src/frontend/app.ts': `export class App {
  start(): void {
    console.log('App started');
  }
}`,
      // Python
      'src/backend/server.py': `class Server:
    def __init__(self, port: int):
        self.port = port
    
    def start(self):
        print(f"Server starting on port {self.port}")`,
      // Java
      'src/api/Controller.java': `public class Controller {
    public String handleRequest(String request) {
        return "Response: " + request;
    }
}`,
      // Go
      'src/services/auth.go': `package services

func Authenticate(token string) bool {
    return len(token) > 0
}`,
      // Rust
      'src/core/engine.rs': `pub struct Engine {
    pub name: String,
}

impl Engine {
    pub fn new(name: String) -> Self {
        Engine { name }
    }
}`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'multi-lang.md');
    await generateMap({
      root: tempDir,
      output: outputPath
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    
    // Check that symbols from all languages are present
    expect(content).toContain('App');           // TypeScript
    expect(content).toContain('Server');        // Python
    expect(content).toContain('Controller');    // Java
    expect(content).toContain('Authenticate');  // Go
    expect(content).toContain('Engine');        // Rust
    
    // Check file extensions are recognized
    expect(content).toContain('app.ts');
    expect(content).toContain('server.py');
    expect(content).toContain('Controller.java');
    expect(content).toContain('auth.go');
    expect(content).toContain('engine.rs');
  });

  it('should handle unsupported file types gracefully', async () => {
    const files = {
      'src/code.ts': `export const hello = 'world';`,
      'README.md': '# This is markdown',
      'config.json': '{"key": "value"}',
      'data.xml': '<root><item>value</item></root>',
      'style.css': 'body { margin: 0; }'
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'mixed.md');
    await generateMap({
      root: tempDir,
      output: outputPath
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    
    // Should include supported files
    expect(content).toContain('code.ts');
    expect(content).toContain('hello');
    
    // Should include unsupported files as file nodes but not analyze their content
    expect(content).toContain('README.md');
    expect(content).toContain('config.json');
    
    // Should not contain symbols from unsupported files
    expect(content).not.toContain('This is markdown');
    expect(content).not.toContain('key');
  });

  it('should respect include patterns for specific languages', async () => {
    const files = {
      'src/app.ts': `export const app = 'typescript';`,
      'src/server.py': `app = 'python'`,
      'src/Main.java': `public class Main {}`,
      'src/main.go': `func main() {}`,
      'src/lib.rs': `pub fn main() {}`
    };
    await createTestFiles(tempDir, files);

    const outputPath = path.join(tempDir, 'filtered.md');
    await generateMap({
      root: tempDir,
      output: outputPath,
      include: ['**/*.{ts,py}'] // Only TypeScript and Python
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    
    // Should include TypeScript and Python
    expect(content).toContain('app.ts');
    expect(content).toContain('server.py');
    expect(content).toContain('app');
    
    // Should not include other languages
    expect(content).not.toContain('Main.java');
    expect(content).not.toContain('main.go');
    expect(content).not.toContain('lib.rs');
  });
});