package adaptive

import (
	"testing"
)

func TestComputeAvgSubmissions(t *testing.T) {
	p := &Profiler{} // no DB needed for compute-only methods

	tests := []struct {
		name        string
		submissions []submissionSummary
		want        float64
	}{
		{
			name:        "empty submissions → 0",
			submissions: []submissionSummary{},
			want:        0,
		},
		{
			name: "single exp, single submission → 1.0",
			submissions: []submissionSummary{
				{ExperimentID: "exp1"},
			},
			want: 1.0,
		},
		{
			name: "one exp, 5 submissions → 5.0",
			submissions: []submissionSummary{
				{ExperimentID: "exp1"},
				{ExperimentID: "exp1"},
				{ExperimentID: "exp1"},
				{ExperimentID: "exp1"},
				{ExperimentID: "exp1"},
			},
			want: 5.0,
		},
		{
			name: "3 exps, 2 subs each → avg 2.0",
			submissions: []submissionSummary{
				{ExperimentID: "exp1"},
				{ExperimentID: "exp1"},
				{ExperimentID: "exp2"},
				{ExperimentID: "exp2"},
				{ExperimentID: "exp3"},
				{ExperimentID: "exp3"},
			},
			want: 2.0,
		},
		{
			name: "4 exps, uneven → 2.5",
			submissions: []submissionSummary{
				{ExperimentID: "exp1"},
				{ExperimentID: "exp1"},
				{ExperimentID: "exp2"},
				{ExperimentID: "exp3"},
				{ExperimentID: "exp3"},
				{ExperimentID: "exp3"},
				{ExperimentID: "exp3"},
				{ExperimentID: "exp4"},
				{ExperimentID: "exp4"},
				{ExperimentID: "exp4"},
			},
			want: 2.5,
		},
		{
			name: "single submission → 1.0",
			submissions: []submissionSummary{
				{ExperimentID: "exp1"},
			},
			want: 1.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.computeAvgSubmissions(tt.submissions)
			if got != tt.want {
				t.Errorf("computeAvgSubmissions(...) = %g, want %g", got, tt.want)
			}
		})
	}
}

func TestComputeLearningPace(t *testing.T) {
	p := &Profiler{}

	tests := []struct {
		name        string
		submissions []submissionSummary
		want        string
	}{
		{
			name:        "fewer than 3 subs → medium",
			submissions: makeSubmissions("exp1", 2),
			want:        "medium",
		},
		{
			name: "avg ≤ 2 → fast (3 exp, 1 sub each)",
			submissions: append(
				append(
					makeSubmissions("exp1", 1),
					makeSubmissions("exp2", 1)...,
				),
				makeSubmissions("exp3", 1)...,
			),
			want: "fast",
		},
		{
			name: "avg ≤ 2 → fast (3 exp, 2 sub each)",
			submissions: append(
				append(
					makeSubmissions("exp1", 2),
					makeSubmissions("exp2", 2)...,
				),
				makeSubmissions("exp3", 2)...,
			),
			want: "fast", // avg=2.0 ≤ 2 → "fast"
		},
		{
			name: "avg ≤ 5 → medium (3 exp, 3 sub each)",
			submissions: append(
				append(
					makeSubmissions("exp1", 3),
					makeSubmissions("exp2", 3)...,
				),
				makeSubmissions("exp3", 3)...,
			),
			want: "medium", // avg=3.0, 3≤5 → "medium"
		},
		{
			name: "avg > 5 → slow",
			submissions: append(
				append(
					makeSubmissions("exp1", 6),
					makeSubmissions("exp2", 6)...,
				),
				makeSubmissions("exp3", 6)...,
			),
			want: "slow",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.computeLearningPace(tt.submissions)
			if got != tt.want {
				t.Errorf("computeLearningPace(...) = %q, want %q", got, tt.want)
			}
		})
	}
}

// Helper: creates n submissions for the same experiment ID.
func makeSubmissions(expID string, n int) []submissionSummary {
	s := make([]submissionSummary, n)
	for i := 0; i < n; i++ {
		s[i] = submissionSummary{ExperimentID: expID}
	}
	return s
}

func TestComputePreferredDifficulty(t *testing.T) {
	p := &Profiler{}

	tests := []struct {
		name    string
		profile StudentProfile
		want    string
	}{
		{
			name: "all default 1500 → medium",
			profile: StudentProfile{
				ProcessELO:   1500,
				ThreadELO:    1500,
				MemoryELO:    1500,
				FsELO:        1500,
				SchedulerELO: 1500,
				DeadlockELO:  1500,
			},
			want: "medium",
		},
		{
			name: "avg < 1200 → easy",
			profile: StudentProfile{
				ProcessELO:   1100,
				ThreadELO:    1100,
				MemoryELO:    1100,
				FsELO:        1100,
				SchedulerELO: 1100,
				DeadlockELO:  1100,
			},
			want: "easy",
		},
		{
			name: "avg >= 1700 → hard",
			profile: StudentProfile{
				ProcessELO:   1800,
				ThreadELO:    1800,
				MemoryELO:    1800,
				FsELO:        1800,
				SchedulerELO: 1800,
				DeadlockELO:  1800,
			},
			want: "hard",
		},
		{
			name: "avg=1200 exactly → medium",
			profile: StudentProfile{
				ProcessELO:   1200,
				ThreadELO:    1200,
				MemoryELO:    1200,
				FsELO:        1200,
				SchedulerELO: 1200,
				DeadlockELO:  1200,
			},
			want: "medium",
		},
		{
			name: "avg=1699.99 → medium",
			profile: StudentProfile{
				ProcessELO:   1699.99,
				ThreadELO:    1700,
				MemoryELO:    1700,
				FsELO:        1700,
				SchedulerELO: 1700,
				DeadlockELO:  1700,
			},
			want: "medium",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.computePreferredDifficulty(tt.profile)
			if got != tt.want {
				t.Errorf("computePreferredDifficulty(...) = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestComputeAvgTime(t *testing.T) {
	p := &Profiler{}

	tests := []struct {
		name       string
		progresses []progressSummary
		want       float64
	}{
		{
			name:       "empty → 0",
			progresses: []progressSummary{},
			want:       0,
		},
		{
			name:       "single 100 → 100",
			progresses: []progressSummary{{TimeSpent: 100}},
			want:       100,
		},
		{
			name:       "100 + 200 → 150",
			progresses: []progressSummary{{TimeSpent: 100}, {TimeSpent: 200}},
			want:       150,
		},
		{
			name:       "zero times → 0",
			progresses: []progressSummary{{TimeSpent: 0}, {TimeSpent: 0}},
			want:       0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.computeAvgTime(tt.progresses)
			if got != tt.want {
				t.Errorf("computeAvgTime(...) = %g, want %g", got, tt.want)
			}
		})
	}
}
