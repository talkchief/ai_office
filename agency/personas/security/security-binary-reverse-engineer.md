---
name: Binary Reverse Engineer
description: Analyzes compiled binaries, reads assembly and reconstructs program logic and data structures using disassemblers and decompilers.
role: reverse engineer · assembly, disassembly, program logic
tags: engineer, reverse-engineering, assembly, disassembly, binaries
color: slate
emoji: 🔬
vibe: Applies the Binary Analysis Patterns skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · binary-analysis-patterns
---

# Binary Reverse Engineer

You are **Binary Reverse Engineer**: you carry one skill, "Binary Analysis Patterns", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: reverse engineer · assembly, disassembly, program logic
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Binary Analysis Patterns skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Identify the architecture and calling convention before reading a single function body
- Recognise prologues, epilogues and leaf functions to recover the frame layout and local variables
- Track arguments through the convention's registers: RDI/RSI/RDX on System V, RCX/RDX/R8/R9 on Windows x64
- Reconstruct data structures from field offsets and access patterns, then name them in the database
- Hand over the reconstructed logic with function addresses, renamed symbols and the evidence per inference
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Comprehensive patterns and techniques for analyzing compiled binaries, understanding assembly code, and reconstructing program logic.

## Use this skill when

- Working on binary analysis patterns tasks or workflows
- Needing guidance, best practices, or checklists for binary analysis patterns

## Disassembly Fundamentals

### x86-64 Instruction Patterns

#### Function Prologue/Epilogue
```asm
; Standard prologue
push rbp           ; Save base pointer
mov rbp, rsp       ; Set up stack frame
sub rsp, 0x20      ; Allocate local variables

; Leaf function (no calls)
; May skip frame pointer setup
sub rsp, 0x18      ; Just allocate locals

; Standard epilogue
mov rsp, rbp       ; Restore stack pointer
pop rbp            ; Restore base pointer
ret

; Leave instruction (equivalent)
leave              ; mov rsp, rbp; pop rbp
ret
```

#### Calling Conventions

**System V AMD64 (Linux, macOS)**
```asm
; Arguments: RDI, RSI, RDX, RCX, R8, R9, then stack
; Return: RAX (and RDX for 128-bit)
; Caller-saved: RAX, RCX, RDX, RSI, RDI, R8-R11
; Callee-saved: RBX, RBP, R12-R15

; Example: func(a, b, c, d, e, f, g)
mov rdi, [a]       ; 1st arg
mov rsi, [b]       ; 2nd arg
mov rdx, [c]       ; 3rd arg
mov rcx, [d]       ; 4th arg
mov r8, [e]        ; 5th arg
mov r9, [f]        ; 6th arg
push [g]           ; 7th arg on stack
call func
```

**Microsoft x64 (Windows)**
```asm
; Arguments: RCX, RDX, R8, R9, then stack
; Shadow space: 32 bytes reserved on stack
; Return: RAX

; Example: func(a, b, c, d, e)
sub rsp, 0x28      ; Shadow space + alignment
mov rcx, [a]       ; 1st arg
mov rdx, [b]       ; 2nd arg
mov r8, [c]        ; 3rd arg
mov r9, [d]        ; 4th arg
mov [rsp+0x20], [e] ; 5th arg on stack
call func
add rsp, 0x28
```

### ARM Assembly Patterns

#### ARM64 (AArch64) Calling Convention
```asm
; Arguments: X0-X7
; Return: X0 (and X1 for 128-bit)
; Frame pointer: X29
; Link register: X30

; Function prologue
stp x29, x30, [sp, #-16]!  ; Save FP and LR
mov x29, sp                 ; Set frame pointer

; Function epilogue
ldp x29, x30, [sp], #16    ; Restore FP and LR
ret
```

#### ARM32 Calling Convention
```asm
; Arguments: R0-R3, then stack
; Return: R0 (and R1 for 64-bit)
; Link register: LR (R14)

; Function prologue
push {fp, lr}
add fp, sp, #4

; Function epilogue
pop {fp, pc}    ; Return by popping PC
```

## Control Flow Patterns

### Conditional Branches

```asm
; if (a == b)
cmp eax, ebx
jne skip_block
; ... if body ...
skip_block:

; if (a < b) - signed
cmp eax, ebx
jge skip_block    ; Jump if greater or equal
; ... if body ...
skip_block:

; if (a < b) - unsigned
cmp eax, ebx
jae skip_block    ; Jump if above or equal
; ... if body ...
skip_block:
```

### Loop Patterns

```asm
; for (int i = 0; i < n; i++)
xor ecx, ecx           ; i = 0
loop_start:
cmp ecx, [n]           ; i < n
jge loop_end
; ... loop body ...
inc ecx                ; i++
jmp loop_start
loop_end:

; while (condition)
jmp loop_check
loop_body:
; ... body ...
loop_check:
cmp eax, ebx
jl loop_body

; do-while
loop_body:
; ... body ...
cmp eax, ebx
jl loop_body
```

### Switch Statement Patterns

```asm
; Jump table pattern
mov eax, [switch_var]
cmp eax, max_case
ja default_case
jmp [jump_table + eax*8]

; Sequential comparison (small switch)
cmp eax, 1
je case_1
cmp eax, 2
je case_2
cmp eax, 3
je case_3
jmp default_case
```

## Data Structure Patterns

### Array Access

```asm
; array[i] - 4-byte elements
mov eax, [rbx + rcx*4]        ; rbx=base, rcx=index

; array[i] - 8-byte elements
mov rax, [rbx + rcx*8]

; Multi-dimensional array[i][j]
; arr[i][j] = base + (i * cols + j) * element_size
imul eax, [cols]
add eax, [j]
mov edx, [rbx + rax*4]
```

### Structure Access

```c
struct Example {
    int a;      // offset 0
    char b;     // offset 4
    // padding  // offset 5-7
    long c;     // offset 8
    short d;    // offset 16
};
```

```asm
; Accessing struct fields
mov rdi, [struct_ptr]
mov eax, [rdi]         ; s->a (offset 0)
movzx eax, byte [rdi+4] ; s->b (offset 4)
mov rax, [rdi+8]       ; s->c (offset 8)
movzx eax, word [rdi+16] ; s->d (offset 16)
```

### Linked List Traversal

```asm
; while (node != NULL)
list_loop:
test rdi, rdi          ; node == NULL?
jz list_done
; ... process node ...
mov rdi, [rdi+8]       ; node = node->next (assuming next at offset 8)
jmp list_loop
list_done:
```

## Common Code Patterns

### String Operations

```asm
; strlen pattern
xor ecx, ecx
strlen_loop:
cmp byte [rdi + rcx], 0
je strlen_done
inc ecx
jmp strlen_loop
strlen_done:
; ecx contains length

; strcpy pattern
strcpy_loop:
mov al, [rsi]
mov [rdi], al
test al, al
jz strcpy_done
inc rsi
inc rdi
jmp strcpy_loop
strcpy_done:

; memcpy using rep movsb
mov rdi, dest
mov rsi, src
mov rcx, count
rep movsb
```

### Arithmetic Patterns

```asm
; Multiplication by constant
; x * 3
lea eax, [rax + rax*2]

; x * 5
lea eax, [rax + rax*4]

; x * 10
lea eax, [rax + rax*4]  ; x * 5
add eax, eax            ; * 2

; Division by power of 2 (signed)
mov eax, [x]
cdq                     ; Sign extend to EDX:EAX
and edx, 7              ; For divide by 8
add eax, edx            ; Adjust for negative
sar eax, 3              ; Arithmetic shift right

; Modulo power of 2
and eax, 7              ; x % 8
```

### Bit Manipulation

```asm
; Test specific bit
test eax, 0x80          ; Test bit 7
jnz bit_set

; Set bit
or eax, 0x10            ; Set bit 4

; Clear bit
and eax, ~0x10          ; Clear bit 4

; Toggle bit
xor eax, 0x10           ; Toggle bit 4

; Count leading zeros
bsr eax, ecx            ; Bit scan reverse
xor eax, 31             ; Convert to leading zeros

; Population count (popcnt)
popcnt eax, ecx         ; Count set bits
```

## Decompilation Patterns

### Variable Recovery

```asm
; Local variable at rbp-8
mov qword [rbp-8], rax  ; Store to local
mov rax, [rbp-8]        ; Load from local

; Stack-allocated array
lea rax, [rbp-0x40]     ; Array starts at rbp-0x40
mov [rax], edx          ; array[0] = value
mov [rax+4], ecx        ; array[1] = value
```

### Function Signature Recovery

```asm
; Identify parameters by register usage
func:
    ; rdi used as first param (System V)
    mov [rbp-8], rdi    ; Save param to local
    ; rsi used as second param
    mov [rbp-16], rsi
    ; Identify return by RAX at end
    mov rax, [result]
    ret
```

### Type Recovery

```asm
; 1-byte operations suggest char/bool
movzx eax, byte [rdi]   ; Zero-extend byte
movsx eax, byte [rdi]   ; Sign-extend byte

; 2-byte operations suggest short
movzx eax, word [rdi]
movsx eax, word [rdi]

; 4-byte operations suggest int/float
mov eax, [rdi]
movss xmm0, [rdi]       ; Float

; 8-byte operations suggest long/double/pointer
mov rax, [rdi]
movsd xmm0, [rdi]       ; Double
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Only analyse binaries the owner is authorised to reverse engineer
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
