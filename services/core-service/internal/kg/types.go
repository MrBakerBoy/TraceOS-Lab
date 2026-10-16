package kg

import "encoding/json"

// Node represents a knowledge graph node.
type Node struct {
	ID         int                    `json:"id"`
	Label      string                 `json:"label"`
	Name       string                 `json:"name"`
	Properties map[string]interface{} `json:"properties"`
}

// Path represents a reasoning path in the knowledge graph.
type Path struct {
	NamePath   []string `json:"name_path"`
	LabelPath  []string `json:"label_path"`
	EdgeLabels []string `json:"edge_labels"`
	Depth      int      `json:"depth"`
}

// ReasoningResult holds the result of a KG reasoning query.
type ReasoningResult struct {
	Paths     []Path   `json:"paths"`
	Concepts  []string `json:"concepts"`
	Trace     string   `json:"trace"`
	Symptoms  []string `json:"symptoms"`
}

// ConceptInfo holds related concepts for teaching.
type ConceptInfo struct {
	Concept       string   `json:"concept"`
	Prerequisites []string `json:"prerequisites"`
	Resolutions   []string `json:"resolutions"`
}

// ToJSON serializes the result for API response.
func (r *ReasoningResult) ToJSON() ([]byte, error) {
	return json.Marshal(r)
}
