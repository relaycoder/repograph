import { describe, it, expect } from 'bun:test';
import { runRepoGraphForTests } from '../test.util.js';

interface TestCase {
  language: string;
  extension: string;
  files: Record<string, string>;
  expectedSymbols: string[];
}

describe('Multi-Language Support', () => {
  const testCases: TestCase[] = [
    {
      language: 'TypeScript',
      extension: 'ts',
      files: {
        'src/calculator.ts': `
/**
 * Represents a calculator.
 */
// Single line comment
class BaseCalc {}
export class Calculator extends BaseCalc implements ICalculator {
  // A field
  precision: number = 2;

  /* Multi-line comment */
  add(a: number, b: number): number { return a + b; }
  
  // An async arrow function property
  multiply = async (a: number, b: number): Promise<number> => {
    return a * b;
  };
}
// An interface
export interface ICalculator { 
  precision: number;
  add(a: number, b: number): number;
}
// A type alias
export type Operation = 'add' | 'multiply';
// An enum
export enum Status { On, Off }
`
      },
      expectedSymbols: ['BaseCalc', 'Calculator', 'precision', 'add', 'multiply', 'ICalculator', 'Operation', 'Status']
    },
    {
      language: 'Python',
      extension: 'py',
      files: {
        'src/math_utils.py': `
# A regular comment
import math
from typing import List, NewType

UserId = NewType('UserId', int) # Type Alias

def my_decorator(func):
    return func

class Base:
  pass

@my_decorator
class MathUtils(Base):
    """
    This is a docstring for the class.
    """
    def calculate_area(self, radius: float) -> float:
        return math.pi * radius ** 2

@my_decorator
def factorial(n: int) -> int:
    """This is a docstring for the function."""
    if n <= 1: return 1
    return n * factorial(n - 1)
`
      },
      expectedSymbols: ['UserId', 'my_decorator', 'Base', 'MathUtils', 'calculate_area', 'factorial']
    },
    {
      language: 'Java',
      extension: 'java',
      files: {
        'src/StringHelper.java': `package com.example;
// Single line comment
/**
 * Javadoc comment.
 */
public class StringHelper {
    /* Multi-line comment */
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
import "fmt" // single import

// Point struct comment
type Point struct { X, Y float64 }

/*
 Multi-line comment
*/
type MyInt int // type alias

func (p Point) Distance() float64 { return 0.0 }
func Add(a, b int) int { return a + b }`
      },
      expectedSymbols: ['Point', 'MyInt', 'Distance', 'Add']
    },
    {
      language: 'Rust',
      extension: 'rs',
      files: {
        'src/lib.rs': `
// Single line comment
/// Doc comment
pub struct Point { x: f64, y: f64 }

/* Multi-line
   comment */
impl Point { 
  pub fn new(x: f64, y: f64) -> Self { Point { x, y } } 
}
pub trait Summable { fn sum(&self) -> i32; }
pub fn calculate_perimeter() -> f64 { 0.0 }
`
      },
      expectedSymbols: ['Point', 'new', 'Summable', 'sum', 'calculate_perimeter']
    },
    {
      language: 'C',
      extension: 'c',
      files: {
        'src/math.c': `#include <stdio.h>
// Struct definition
typedef struct { 
    double x; /* x coord */
    double y; // y coord
} Point;
// Enum definition
enum Color { RED, GREEN, BLUE };

// Function prototype
double calculate_distance(Point p1, Point p2);

// Function definition
double calculate_distance(Point p1, Point p2) { 
    return 0.0; 
}`
      },
      expectedSymbols: ['Point', 'Color', 'calculate_distance']
    },
    {
      language: 'C++',
      extension: 'cpp',
      files: {
        'src/main.cpp': `#include <iostream>
// single line comment
/* multi-line comment */
namespace MyNamespace {
  class MyClass {
  public:
      int myMethod(int arg);
  };
}
int MyNamespace::MyClass::myMethod(int arg) { return arg; }
int main() { return 0; }`
      },
      expectedSymbols: ['MyNamespace', 'MyClass', 'myMethod', 'main']
    },
    {
      language: 'C++ Header',
      extension: 'h',
      files: {
        'src/myclass.h': `
#ifndef MYCLASS_H
#define MYCLASS_H

class MyClass {
public:
    void myMethod();
private:
    int myField;
};

#endif
    `
      },
      expectedSymbols: ['MyClass', 'myMethod', 'myField']
    },
    {
      language: 'C#',
      extension: 'cs',
      files: {
        'src/main.cs': `
// single line comment
namespace HelloWorld
{
    /* multi-line
       comment */
    class Program
    {
        static void Main(string[] args)
        {
            System.Console.WriteLine("Hello, World!");
        }
    }
    public interface IMyInterface { void Method(); }
    public enum MyEnum { A, B }
}`
      },
      expectedSymbols: ['HelloWorld', 'Program', 'Main', 'IMyInterface', 'Method', 'MyEnum']
    },
    {
      language: 'CSS',
      extension: 'css',
      files: {
        'src/styles.css': `
/* A comment */
@import url('...'); /* at-rule */
.my-class { color: red; }
#my-id { color: blue; }`
      },
      // The current analyzer may not extract CSS selectors as symbols,
      // so this mainly tests that the file is parsed without errors.
      expectedSymbols: []
    },
    {
      language: 'JavaScript (JSX)',
      extension: 'jsx',
      files: {
        'src/component.jsx': `
import React from 'react';

// A comment
function MyComponent({ name }) {
  return <h1>Hello, {name}</h1>;
}

const ArrowComponent = () => (
  <div>
    <p>I'm an arrow component</p>
  </div>
);

export default MyComponent;
`
      },
      expectedSymbols: ['MyComponent', 'ArrowComponent']
    },
    {
      language: 'TypeScript (TSX)',
      extension: 'tsx',
      files: {
        'src/component.tsx': `
import React from 'react';

interface MyComponentProps {
  name: string;
}

// A comment
function MyComponent({ name }: MyComponentProps): JSX.Element {
  return <h1>Hello, {name}</h1>;
}

const ArrowComponent = (): JSX.Element => (
  <div>
    <p>I'm an arrow component</p>
  </div>
);

export default MyComponent;
`
      },
      expectedSymbols: ['MyComponentProps', 'MyComponent', 'ArrowComponent']
    },
    {
      language: 'PHP',
      extension: 'php',
      files: {
        'src/user.php': `
<?php
// single line
# another single line
/*
multi-line
*/

namespace App\\\\Models;

class User extends Model {
    public function getName() {
        return $this->name;
    }
}

function helper_function() {
  return true;
}
`
      },
      expectedSymbols: ['App\\\\Models', 'User', 'getName', 'helper_function']
    },
    {
      language: 'Ruby',
      extension: 'rb',
      files: {
        'src/vehicle.rb': `
# A comment
=begin
A multi-line comment
=end
module Drivable
  def drive
    puts "Driving"
  end
end

class Vehicle
  def self.description
    "A vehicle"
  end
end

class Car < Vehicle
  include Drivable
  def honk
    "beep"
  end
end
`
      },
      expectedSymbols: ['Drivable', 'drive', 'Vehicle', 'description', 'Car', 'honk']
    },
    {
      language: 'Solidity',
      extension: 'sol',
      files: {
        'src/SimpleStorage.sol': `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 storedData;
    event DataStored(uint256 data);

    function set(uint256 x) public {
        storedData = x;
        emit DataStored(x);
    }

    function get() public view returns (uint256) {
        return storedData;
    }
}`
      },
      expectedSymbols: ['SimpleStorage', 'DataStored', 'set', 'get']
    },
    {
      language: 'Swift',
      extension: 'swift',
      files: {
        'src/shapes.swift': `
// A comment
/* multi-line */
struct Point {
    var x: Double, y: Double
}

extension Point {
    var magnitude: Double {
        return (x*x + y*y).squareRoot()
    }
}

protocol Shape {
    func area() -> Double
}

enum ShapeType<T: Shape> {
    case circle(radius: Double)
    case rectangle(width: Double, height: Double)
}
`
      },
      expectedSymbols: ['Point', 'magnitude', 'Shape', 'area', 'ShapeType']
    },
    {
      language: 'Vue',
      extension: 'vue',
      files: {
        'src/component.vue': `
<script setup lang="ts">
import { ref } from 'vue'

const msg = ref('Hello World!')

function logMessage() {
  console.log(msg.value)
}
</script>

<template>
  <h1>{{ msg }}</h1>
</template>

<style scoped>
h1 {
  color: red;
}
</style>
`
      },
      expectedSymbols: ['msg', 'logMessage']
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