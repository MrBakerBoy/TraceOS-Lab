package evaluator

import "github.com/traceos-lab/core-service/internal/model"

// TestPointResult holds the evaluation result for a single test point.
// It aliases the shared model type so the evaluator, repository, NATS events
// and HTTP API all serialize an identical shape.
type TestPointResult = model.TestPointData

// NewScoreResult holds the result of the new scoring algorithm.
type NewScoreResult struct {
	TotalScore   int               `json:"total_score"`
	IsQualified  bool              `json:"is_qualified"`
	CorePassed   bool              `json:"core_passed"`
	CoreScore    int               `json:"core_score"`
	EdgeScore    int               `json:"edge_score"`
	Points       []TestPointResult `json:"test_points"`
	CompileError *string           `json:"compile_error,omitempty"`
	RuntimeError *string           `json:"runtime_error,omitempty"`
}

// normalizeType maps DB type values to canonical scoring types.
// Accepts both old ("normal"/"edge_case") and new ("core"/"edge") naming.
// Other values (e.g. "performance", "security") default to "edge".
func normalizeType(t string) string {
	switch t {
	case "core", "normal":
		return "core"
	default:
		return "edge"
	}
}

// NewScore computes the total score based on test point weighted accumulation.
func NewScore(testPointResults []TestPointResult) *NewScoreResult {
	total := 0
	coreAllPassed := true
	coreScore := 0
	edgeScore := 0

	for _, tp := range testPointResults {
		nt := normalizeType(tp.Type)
		if tp.Passed {
			total += tp.Weight
			if nt == "core" {
				coreScore += tp.Weight
			} else {
				edgeScore += tp.Weight
			}
		}
		if nt == "core" && !tp.Passed {
			coreAllPassed = false
		}
	}

	isQualified := coreAllPassed

	return &NewScoreResult{
		TotalScore:  total,
		IsQualified: isQualified,
		CorePassed:  coreAllPassed,
		CoreScore:   coreScore,
		EdgeScore:   edgeScore,
		Points:      testPointResults,
	}
}

// buildAssertionDetails flattens an evaluated assertion doc into a list of
// per-assertion details for the API. Each entry carries its category-level
// pass state plus the free-text result string produced by the evaluator.
func buildAssertionDetails(doc *AssertionsDoc, evalRes *EvalResult) []model.AssertionDetail {
	if doc == nil || evalRes == nil {
		return nil
	}
	s := evalRes.Summary
	out := make([]model.AssertionDetail, 0, 8)

	out = append(out, model.AssertionDetail{
		Category: "exit_code",
		Passed:   s.ExitCodePassed,
		Detail:   s.ExitCodeDetail,
	})

	if len(doc.OutputAssertions) > 0 {
		for _, d := range s.OutputDetails {
			out = append(out, model.AssertionDetail{Category: "output", Passed: s.OutputPassed, Detail: d})
		}
	}
	if doc.SyscallAssertions != nil {
		for _, d := range s.SyscallDetails {
			out = append(out, model.AssertionDetail{Category: "syscall", Passed: s.SyscallPassed, Detail: d})
		}
	}
	if doc.BehaviorAssertions != nil {
		for _, d := range s.BehaviorDetails {
			out = append(out, model.AssertionDetail{Category: "behavior", Passed: s.BehaviorPassed, Detail: d})
		}
	}
	if doc.NumericAssertions != nil && s.NumericDetail != "" {
		out = append(out, model.AssertionDetail{Category: "numeric", Passed: s.NumericPassed, Detail: s.NumericDetail})
	}

	return out
}