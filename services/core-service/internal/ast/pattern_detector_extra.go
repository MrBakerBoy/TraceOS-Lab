package ast

// detectMutexPatterns checks for mutex usage issues per function:
//   - lock without matching unlock in the same function
//   - double lock (two consecutive locks without intervening unlock)
//
// This complements ResourceTracker.checkMutexBalance by emitting CodeIssue
// entries directly, which surface in the audit "issues" list.
func (d *PatternDetector) detectMutexPatterns(ops []MutexOp, pr *ParseResult, issues *[]CodeIssue) {
	type key struct{ funcName, mutexVar string }
	locks := make(map[key][]int)
	unlocks := make(map[key][]int)

	for _, op := range ops {
		k := key{op.FuncName, op.MutexVar}
		if op.OpType == "lock" {
			locks[k] = append(locks[k], op.Line)
		} else if op.OpType == "unlock" {
			unlocks[k] = append(unlocks[k], op.Line)
		}
	}

	for k, lockLines := range locks {
		unlockLines := unlocks[k]
		if len(unlockLines) < len(lockLines) {
			*issues = append(*issues, CodeIssue{
				Line:        lockLines[len(lockLines)-1],
				Severity:    "error",
				Category:    "resource_leak",
				Title:       "mutex lock没有对应的unlock",
				Description: k.mutexVar + " 在函数 " + k.funcName + " 中lock次数多于unlock，可能存在未释放的锁",
				Suggestion:  "确保每个lock路径都有对应的unlock，使用goto cleanup模式",
				Tags:        []string{"mutex", "resource_leak"},
			})
		}

		// Check for double lock (two locks without intervening unlock)
		for i := 0; i < len(lockLines)-1; i++ {
			hasUnlockBetween := false
			for _, u := range unlockLines {
				if u > lockLines[i] && u < lockLines[i+1] {
					hasUnlockBetween = true
					break
				}
			}
			if !hasUnlockBetween {
				*issues = append(*issues, CodeIssue{
					Line:        lockLines[i+1],
					Severity:    "error",
					Category:    "race_condition",
					Title:       "连续两次lock，可能死锁",
					Description: k.mutexVar + " 在函数 " + k.funcName + " 中连续lock两次没有中间unlock",
					Suggestion:  "检查是否误用了mutex；如需可重入锁，使用递归mutex",
					Tags:        []string{"double-lock", "deadlock"},
				})
			}
		}
	}
}

// detectMemoryPatterns checks for memory allocation/free imbalance per function.
func (d *PatternDetector) detectMemoryPatterns(ops []AllocOp, pr *ParseResult, issues *[]CodeIssue) {
	type key struct{ funcName string }
	mallocs := make(map[key][]int)
	frees := make(map[key][]int)

	for _, op := range ops {
		k := key{op.FuncName}
		if op.OpType == "malloc" || op.OpType == "calloc" || op.OpType == "realloc" {
			mallocs[k] = append(mallocs[k], op.Line)
		} else if op.OpType == "free" {
			frees[k] = append(frees[k], op.Line)
		}
	}

	for k, mLines := range mallocs {
		fLines := frees[k]
		if len(fLines) < len(mLines) {
			*issues = append(*issues, CodeIssue{
				Line:        mLines[len(mLines)-1],
				Severity:    "warning",
				Category:    "resource_leak",
				Title:       "malloc没有对应的free",
				Description: "函数 " + k.funcName + " 中malloc/calloc次数多于free，可能存在内存泄漏",
				Suggestion:  "每次malloc/calloc都应该有对应的free，建议使用valgrind检查",
				Tags:        []string{"memory", "leak"},
			})
		}
	}
}

// detectFDPatterns checks for file descriptor open/close imbalance per function.
func (d *PatternDetector) detectFDPatterns(ops []FDOp, pr *ParseResult, issues *[]CodeIssue) {
	type key struct{ funcName string }
	opens := make(map[key][]int)
	closes := make(map[key][]int)

	for _, op := range ops {
		k := key{op.FuncName}
		if op.OpType == "open" || op.OpType == "fopen" || op.OpType == "socket" {
			opens[k] = append(opens[k], op.Line)
		} else if op.OpType == "close" || op.OpType == "fclose" {
			closes[k] = append(closes[k], op.Line)
		}
	}

	for k, oLines := range opens {
		cLines := closes[k]
		if len(cLines) < len(oLines) {
			*issues = append(*issues, CodeIssue{
				Line:        oLines[len(oLines)-1],
				Severity:    "warning",
				Category:    "resource_leak",
				Title:       "open/fopen没有对应的close/fclose",
				Description: "函数 " + k.funcName + " 中open次数多于close，可能存在fd泄漏",
				Suggestion:  "确保所有打开的文件描述符都在使用后被关闭",
				Tags:        []string{"fd", "leak"},
			})
		}
	}
}
