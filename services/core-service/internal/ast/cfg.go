package ast

// CFGBuilder constructs a simple control flow representation.
type CFGBuilder struct {
	parser *Parser
}

// NewCFGBuilder creates a CFG builder.
func NewCFGBuilder(parser *Parser) *CFGBuilder {
	return &CFGBuilder{parser: parser}
}

// BasicBlock represents a linear sequence of code.
type BasicBlock struct {
	StartLine int      `json:"start_line"`
	EndLine   int      `json:"end_line"`
	FuncName  string   `json:"func_name"`
	Successors []int   `json:"successors"` // indices of successor blocks
}

// CFGResult holds the full CFG analysis.
type CFGResult struct {
	Blocks     []BasicBlock `json:"blocks"`
	EntryBlock int          `json:"entry_block"`
	ExitBlocks []int        `json:"exit_blocks"`
}

// UnreachableReturn represents a return statement that may skip cleanup.
type UnreachableReturn struct {
	ReturnLine    int    `json:"return_line"`
	FuncName      string `json:"func_name"`
	SkipsCleanup  bool   `json:"skips_cleanup"`
	CleanupLines  []int  `json:"cleanup_lines,omitempty"`
}

// BuildCFG analyzes code for control flow issues.
// Focuses on: early returns that skip resource cleanup (unlock/free/close).
func (b *CFGBuilder) BuildCFG(code string, parseResult *ParseResult) *CFGResult {
	lines := b.parser.Lines(code)

	result := &CFGResult{
		Blocks:     make([]BasicBlock, 0),
		ExitBlocks: make([]int, 0),
	}

	// Group by function
	funcBlocks := make(map[string][]BasicBlock)
	for _, fn := range parseResult.Functions {
		blocks := b.splitBlocks(lines, fn, parseResult)
		offset := len(result.Blocks)
		for i := range blocks {
			blocks[i].FuncName = fn.Name
			for j := range blocks[i].Successors {
				blocks[i].Successors[j] += offset
			}
		}
		funcBlocks[fn.Name] = blocks
		result.Blocks = append(result.Blocks, blocks...)
	}
	_ = funcBlocks

	if len(result.Blocks) > 0 {
		result.EntryBlock = 0
	}
	return result
}

func (b *CFGBuilder) splitBlocks(lines []string, fn Function, pr *ParseResult) []BasicBlock {
	// Simplified: one block per function for now
	block := BasicBlock{
		StartLine:  fn.StartLine,
		EndLine:    fn.EndLine,
		FuncName:   fn.Name,
		Successors: []int{},
	}
	return []BasicBlock{block}
}

// FindUnreachableCleanup finds early returns that skip resource cleanup.
// Uses brace-depth analysis to suppress false positives: if a return is
// inside a conditional branch (deeper nesting) and the cleanup op is in
// the main path after the branch (shallower nesting), the return cannot
// reach the cleanup, so it's NOT a real issue.
func (b *CFGBuilder) FindUnreachableCleanup(code string, pr *ParseResult) []UnreachableReturn {
	var findings []UnreachableReturn

	braceDepth := b.computeBraceDepths(code)

	for _, fn := range pr.Functions {
		var returns []ControlFlow
		for _, cf := range pr.ControlFlows {
			if cf.FuncName == fn.Name && cf.Type == "return" {
				returns = append(returns, cf)
			}
		}

		for _, ret := range returns {
			if ret.Line >= fn.EndLine {
				continue
			}

			var skippedCleanups []int
			for _, m := range pr.MutexOps {
				if m.FuncName == fn.Name && m.OpType == "unlock" && m.Line > ret.Line &&
					b.isReachable(braceDepth, ret.Line, m.Line) {
					skippedCleanups = append(skippedCleanups, m.Line)
				}
			}
			for _, a := range pr.AllocOps {
				if a.FuncName == fn.Name && a.OpType == "free" && a.Line > ret.Line &&
					b.isReachable(braceDepth, ret.Line, a.Line) {
					skippedCleanups = append(skippedCleanups, a.Line)
				}
			}
			for _, f := range pr.FDOps {
				if f.FuncName == fn.Name && f.OpType == "close" && f.Line > ret.Line &&
					b.isReachable(braceDepth, ret.Line, f.Line) {
					skippedCleanups = append(skippedCleanups, f.Line)
				}
			}

			if len(skippedCleanups) > 0 {
				findings = append(findings, UnreachableReturn{
					ReturnLine:   ret.Line,
					FuncName:     fn.Name,
					SkipsCleanup: true,
					CleanupLines: skippedCleanups,
				})
			}
		}
	}

	return findings
}

// computeBraceDepths returns a map of 1-based line number to brace nesting
// depth. Content inside a block gets the block's depth (measured before
// the line's own closing braces).
func (b *CFGBuilder) computeBraceDepths(code string) map[int]int {
	depths := make(map[int]int)
	lines := b.parser.Lines(code)
	depth := 0
	for i, line := range lines {
		lineDepth := depth
		for _, ch := range line {
			if ch == '{' {
				depth++
				lineDepth = depth
			}
			if ch == '}' {
				depth--
			}
		}
		depths[i+1] = lineDepth
	}
	return depths
}

// isReachable checks whether a cleanup op at opLine could be reached
// from a return at retLine based on brace nesting depth. If the return
// is deeper (inside an if-block) and the cleanup is shallower (main path),
// they are on different branches -- the return cannot skip the cleanup.
func (b *CFGBuilder) isReachable(depths map[int]int, retLine, opLine int) bool {
	retDepth, ok1 := depths[retLine]
	opDepth, ok2 := depths[opLine]
	if !ok1 || !ok2 {
		return true
	}
	return retDepth >= opDepth
}
